import { and, count, eq, inArray, or } from "drizzle-orm";

import { buildDBClient } from "./db";
import { RunnerFuncs, RunnerOptions } from "./options";
import { DequeueTarget, SqliteQueue, attemptDequeueFromQueues } from "./queue";
import { Job, tasksTable } from "./schema";
import { Runner } from "./runner";

export interface RunnerPoolOptions {
  pollIntervalMs: number;
}

export type PooledRunnerOptions<T> = Omit<RunnerOptions<T>, "pollIntervalMs">;

interface RunnerRegistration {
  target: DequeueTarget;
  concurrency: number;
  inFlight: number;
  runOnce: (job: Job) => Promise<void>;
}

/**
 * Runs multiple queues using a single cross-queue polling loop.
 *
 * Each queue keeps its own concurrency, timeout, validator, and callbacks. When
 * all registered queues are idle, the pool issues one dequeue query per poll
 * interval regardless of how many queues are registered.
 */
export class RunnerPool {
  private readonly db: ReturnType<typeof buildDBClient>;
  private readonly opts: RunnerPoolOptions;
  private readonly registrations = new Map<string, RunnerRegistration>();
  private readonly inFlight = new Map<number, Promise<void>>();
  private stopping = false;
  private running = false;
  private wakeVersion = 0;
  private wakeWaiter?: () => void;

  constructor(db: ReturnType<typeof buildDBClient>, opts: RunnerPoolOptions) {
    if (opts.pollIntervalMs <= 0) {
      throw new Error("pollIntervalMs must be greater than zero");
    }
    this.db = db;
    this.opts = opts;
  }

  /** Register a queue and its independently typed handler with this pool. */
  register<T, R = void>(
    queue: SqliteQueue<T>,
    funcs: RunnerFuncs<T, R>,
    opts: PooledRunnerOptions<T>,
  ): this {
    if (this.running) {
      throw new Error("Queues cannot be registered while the pool is running");
    }
    if (queue.db !== this.db) {
      throw new Error(
        "All queues in a RunnerPool must use the pool's database",
      );
    }
    if (this.registrations.has(queue.name())) {
      throw new Error(`Queue ${queue.name()} is already registered`);
    }
    if (opts.concurrency <= 0) {
      throw new Error("concurrency must be greater than zero");
    }

    const runner = new Runner(queue, funcs, {
      ...opts,
      pollIntervalMs: this.opts.pollIntervalMs,
    });
    this.registrations.set(queue.name(), {
      target: {
        queueName: queue.name(),
        timeoutSecs: opts.timeoutSecs,
        keepFailedJobs: queue.options.keepFailedJobs,
      },
      concurrency: opts.concurrency,
      inFlight: 0,
      runOnce: async (job) => await runner.runOnce(job),
    });
    return this;
  }

  async run(): Promise<void> {
    await this.runImpl(false);
  }

  async runUntilEmpty(): Promise<void> {
    await this.runImpl(true);
  }

  stop(): void {
    this.stopping = true;
    this.wake();
  }

  private async runImpl(breakOnEmpty: boolean): Promise<void> {
    if (this.running) {
      throw new Error("RunnerPool is already running");
    }
    if (this.registrations.size === 0) {
      throw new Error("RunnerPool has no registered queues");
    }

    this.running = true;
    try {
      while (!this.stopping) {
        const observedWakeVersion = this.wakeVersion;
        const targets = [...this.registrations.values()]
          .filter((registration) => {
            return registration.inFlight < registration.concurrency;
          })
          .map((registration) => registration.target);

        if (targets.length === 0) {
          await this.waitForWake(observedWakeVersion);
          continue;
        }

        const job = await attemptDequeueFromQueues(this.db, targets);
        if (job) {
          const registration = this.registrations.get(job.queue);
          if (!registration) {
            throw new Error(`Queue ${job.queue} is not registered`);
          }

          registration.inFlight++;
          const promise = registration.runOnce(job).finally(() => {
            registration.inFlight--;
            this.inFlight.delete(job.id);
            this.wake();
          });
          this.inFlight.set(job.id, promise);
          continue;
        }

        if (
          breakOnEmpty &&
          this.inFlight.size === 0 &&
          !(await this.hasPendingJobs())
        ) {
          break;
        }

        await this.waitForWake(observedWakeVersion);
      }
    } finally {
      await Promise.allSettled(this.inFlight.values());
      this.running = false;
    }
  }

  private async hasPendingJobs(): Promise<boolean> {
    const queueNames = [...this.registrations.keys()];
    const [result] = await this.db
      .select({ count: count() })
      .from(tasksTable)
      .where(andQueueIsPending(queueNames));
    return result.count > 0;
  }

  private wake(): void {
    this.wakeVersion++;
    this.wakeWaiter?.();
  }

  private async waitForWake(observedWakeVersion: number): Promise<void> {
    if (this.stopping || observedWakeVersion !== this.wakeVersion) {
      return;
    }

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(finish, this.opts.pollIntervalMs);
      const pool = this;

      function finish() {
        clearTimeout(timeout);
        if (pool.wakeWaiter === finish) {
          pool.wakeWaiter = undefined;
        }
        resolve();
      }

      this.wakeWaiter = finish;
    });
  }
}

function andQueueIsPending(queueNames: string[]) {
  return and(
    inArray(tasksTable.queue, queueNames),
    or(
      eq(tasksTable.status, "pending"),
      eq(tasksTable.status, "pending_retry"),
    ),
  );
}
