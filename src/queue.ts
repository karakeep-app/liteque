import assert from "node:assert";
import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";

import { buildDBClient } from "./db";
import { EnqueueOptions, SqliteQueueOptions } from "./options";
import { Job, tasksTable } from "./schema";

// generate random id
function generateAllocationId() {
  return Math.random().toString(36).substring(2, 15);
}

export interface DequeueTarget {
  queueName: string;
  timeoutSecs: number;
  keepFailedJobs: boolean;
}

/**
 * Atomically claims the next available job from any of the supplied queues.
 */
export async function attemptDequeueFromQueues(
  db: ReturnType<typeof buildDBClient>,
  targets: readonly DequeueTarget[],
): Promise<Job | null> {
  if (targets.length === 0) {
    return null;
  }

  const targetsByName = new Map(
    targets.map((target) => [target.queueName, target]),
  );
  const queueNames = [...targetsByName.keys()];

  return await db.transaction(async (txn) => {
    while (true) {
      const now = new Date();
      const jobs = await txn
        .select()
        .from(tasksTable)
        .where(
          and(
            inArray(tasksTable.queue, queueNames),
            or(
              lte(tasksTable.availableAt, now),
              isNull(tasksTable.availableAt),
            ),
            or(
              // Not picked by a worker yet
              eq(tasksTable.status, "pending"),

              // Failed but still has attempts left
              eq(tasksTable.status, "pending_retry"),

              // Expired and still has attempts left
              and(
                eq(tasksTable.status, "running"),
                lt(tasksTable.expireAt, now),
              ),
            ),
          ),
        )
        .orderBy(
          asc(tasksTable.priority),
          asc(tasksTable.createdAt),
          asc(tasksTable.id),
        )
        .limit(1);

      if (jobs.length === 0) {
        return null;
      }
      assert(jobs.length === 1);
      const job = jobs[0];
      const target = targetsByName.get(job.queue);
      if (!target) {
        throw new Error(`Queue ${job.queue} is not registered for dequeue`);
      }

      if (job.numRunsLeft === 0) {
        // An expired job with no attempts remaining cannot be claimed again.
        if (target.keepFailedJobs) {
          await txn
            .update(tasksTable)
            .set({ status: "failed", expireAt: null })
            .where(
              and(
                eq(tasksTable.id, job.id),
                eq(tasksTable.allocationId, job.allocationId),
              ),
            );
        } else {
          await txn
            .delete(tasksTable)
            .where(
              and(
                eq(tasksTable.id, job.id),
                eq(tasksTable.allocationId, job.allocationId),
              ),
            );
        }
        continue;
      }

      const result = await txn
        .update(tasksTable)
        .set({
          status: "running",
          numRunsLeft: job.numRunsLeft - 1,
          allocationId: generateAllocationId(),
          expireAt: new Date(now.getTime() + target.timeoutSecs * 1000),
        })
        .where(
          and(
            eq(tasksTable.id, job.id),

            // The compare and swap is necessary to avoid race conditions
            eq(tasksTable.allocationId, job.allocationId),
          ),
        )
        .returning();
      if (result.length === 0) {
        continue;
      }
      assert(result.length === 1);
      return result[0];
    }
  });
}

export class SqliteQueue<T> {
  queueName: string;
  db: ReturnType<typeof buildDBClient>;
  options: SqliteQueueOptions;

  constructor(
    name: string,
    db: ReturnType<typeof buildDBClient>,
    options: SqliteQueueOptions,
  ) {
    this.queueName = name;
    this.options = options;
    this.db = db;
  }

  name() {
    return this.queueName;
  }

  /**
   * Enqueue a job into the queue.
   * If a job with the same idempotency key is already enqueued, it will be ignored and undefined will be returned.
   */
  async enqueue(
    payload: T,
    options?: EnqueueOptions,
  ): Promise<Job | undefined> {
    const opts = options ?? {};
    const numRetries =
      opts.numRetries ?? this.options.defaultJobArgs.numRetries;
    const priority = opts.priority ?? 0;
    const availableAt = new Date(Date.now() + (opts.delayMs ?? 0));
    const [job] = await this.db
      .insert(tasksTable)
      .values({
        queue: this.queueName,
        payload: JSON.stringify(payload),
        numRunsLeft: numRetries + 1,
        maxNumRuns: numRetries + 1,
        allocationId: generateAllocationId(),
        idempotencyKey: opts.idempotencyKey,
        priority: priority,
        availableAt,
      })
      .onConflictDoNothing({
        target: [tasksTable.queue, tasksTable.idempotencyKey],
      })
      .returning();

    return job;
  }

  async stats() {
    const res = await this.db
      .select({ status: tasksTable.status, count: count() })
      .from(tasksTable)
      .where(eq(tasksTable.queue, this.queueName))
      .groupBy(tasksTable.status);

    return res.reduce(
      (acc, r) => {
        acc[r.status] += r.count;
        return acc;
      },
      {
        pending: 0,
        pending_retry: 0,
        running: 0,
        failed: 0,
      },
    );
  }

  async attemptDequeue(options: { timeoutSecs: number }): Promise<Job | null> {
    return await attemptDequeueFromQueues(this.db, [
      {
        queueName: this.queueName,
        timeoutSecs: options.timeoutSecs,
        keepFailedJobs: this.options.keepFailedJobs,
      },
    ]);
  }

  async finalize(
    id: number,
    alloctionId: string,
    status: "completed" | "pending_retry" | "failed",
    availableAt: Date = new Date(),
    refundRetry = false,
  ) {
    if (
      status === "completed" ||
      (status === "failed" && !this.options.keepFailedJobs)
    ) {
      await this.db
        .delete(tasksTable)
        .where(
          and(eq(tasksTable.id, id), eq(tasksTable.allocationId, alloctionId)),
        );
    } else {
      await this.db
        .update(tasksTable)
        .set({
          status: status,
          expireAt: null,
          availableAt,
          numRunsLeft: refundRetry
            ? sql<number>`${tasksTable.numRunsLeft} + 1`
            : sql<number>`${tasksTable.numRunsLeft}`,
        })
        .where(
          and(eq(tasksTable.id, id), eq(tasksTable.allocationId, alloctionId)),
        );
    }
  }

  /**
   * Cancel all non-running tasks in the queue.
   * This includes tasks with status "pending", "pending_retry", and "failed".
   * Running tasks are not affected.
   * @returns The number of tasks that were cancelled
   */
  async cancelAllNonRunning(): Promise<number> {
    const result = await this.db
      .delete(tasksTable)
      .where(
        and(
          eq(tasksTable.queue, this.queueName),
          or(
            eq(tasksTable.status, "pending"),
            eq(tasksTable.status, "pending_retry"),
            eq(tasksTable.status, "failed"),
          ),
        ),
      )
      .returning({ id: tasksTable.id });

    return result.length;
  }
}
