/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, test } from "vitest";

import { SqliteQueue, buildDBClient } from "./";

interface Work {
  increment: number;
  succeedAfter?: number;
  blockForSec?: number;
}

describe("SqliteQueue", () => {
  test("idempotency keys", async () => {
    const queue = new SqliteQueue<Work>(
      "queue1",
      buildDBClient(":memory:", { runMigrations: true }),
      {
        defaultJobArgs: {
          numRetries: 0,
        },
        keepFailedJobs: false,
      },
    );

    await queue.enqueue({ increment: 1 });
    await queue.enqueue({ increment: 2 }, { idempotencyKey: "2" });
    await queue.enqueue({ increment: 2 }, { idempotencyKey: "2" });
    await queue.enqueue({ increment: 2 }, { idempotencyKey: "2" });
    await queue.enqueue({ increment: 3 }, { idempotencyKey: "3" });

    expect(await queue.stats()).toEqual({
      pending: 3,
      running: 0,
      pending_retry: 0,
      failed: 0,
    });
  });

  test("keep failed jobs", async () => {
    const queueKeep = new SqliteQueue<Work>(
      "queue1",
      buildDBClient(":memory:", { runMigrations: true }),
      {
        defaultJobArgs: {
          numRetries: 0,
        },
        keepFailedJobs: true,
      },
    );

    const queueDontKeep = new SqliteQueue<Work>(
      "queue2",
      buildDBClient(":memory:", { runMigrations: true }),
      {
        defaultJobArgs: {
          numRetries: 0,
        },
        keepFailedJobs: false,
      },
    );

    const job1 = await queueKeep.enqueue({ increment: 1 });
    const job2 = await queueDontKeep.enqueue({ increment: 1 });

    expect(await queueKeep.stats()).toEqual({
      pending: 1,
      running: 0,
      pending_retry: 0,
      failed: 0,
    });
    expect(await queueDontKeep.stats()).toEqual({
      pending: 1,
      running: 0,
      pending_retry: 0,
      failed: 0,
    });

    queueKeep.finalize(job1!.id, job1!.allocationId, "failed");
    queueDontKeep.finalize(job2!.id, job2!.allocationId, "failed");

    expect(await queueKeep.stats()).toEqual({
      pending: 0,
      running: 0,
      pending_retry: 0,
      failed: 1,
    });
    expect(await queueDontKeep.stats()).toEqual({
      pending: 0,
      running: 0,
      pending_retry: 0,
      failed: 0,
    });
  });

  test("priority ordering", async () => {
    const queue = new SqliteQueue<Work>(
      "priority-queue",
      buildDBClient(":memory:", { runMigrations: true }),
      {
        defaultJobArgs: {
          numRetries: 0,
        },
        keepFailedJobs: false,
      },
    );

    // Enqueue jobs with different priorities (0 = highest, higher numbers = lower priority)
    await queue.enqueue({ increment: 1 }, { priority: 2 });
    await queue.enqueue({ increment: 2 }, { priority: 0 }); // Highest priority
    await queue.enqueue({ increment: 3 }, { priority: 1 });
    await queue.enqueue({ increment: 4 }); // Default priority (0)
    await queue.enqueue({ increment: 5 }, { priority: 3 });

    // Dequeue jobs and verify they come out in priority order
    const job1 = await queue.attemptDequeue({ timeoutSecs: 30 });
    const job2 = await queue.attemptDequeue({ timeoutSecs: 30 });
    const job3 = await queue.attemptDequeue({ timeoutSecs: 30 });
    const job4 = await queue.attemptDequeue({ timeoutSecs: 30 });
    const job5 = await queue.attemptDequeue({ timeoutSecs: 30 });

    expect(job1).not.toBeNull();
    expect(job2).not.toBeNull();
    expect(job3).not.toBeNull();
    expect(job4).not.toBeNull();
    expect(job5).not.toBeNull();

    // Should get priority 0 jobs first (increment 2 and 4), then priority 1 (increment 3),
    // then priority 2 (increment 1), then priority 3 (increment 5)
    const payloads = [job1, job2, job3, job4, job5].map(
      (job) => JSON.parse(job!.payload) as Work,
    );

    // Priority 0 jobs should come first (increment 2 and 4)
    expect([payloads[0].increment, payloads[1].increment].sort()).toEqual([
      2, 4,
    ]);
    // Priority 1 job should come third
    expect(payloads[2].increment).toBe(3);
    // Priority 2 job should come fourth
    expect(payloads[3].increment).toBe(1);
    // Priority 3 job should come last
    expect(payloads[4].increment).toBe(5);
  });

  test("priority with same priority uses FIFO", async () => {
    const queue = new SqliteQueue<Work>(
      "fifo-queue",
      buildDBClient(":memory:", { runMigrations: true }),
      {
        defaultJobArgs: {
          numRetries: 0,
        },
        keepFailedJobs: false,
      },
    );

    // Enqueue multiple jobs with same priority
    await queue.enqueue({ increment: 1 }, { priority: 1 });
    await queue.enqueue({ increment: 2 }, { priority: 1 });
    await queue.enqueue({ increment: 3 }, { priority: 1 });

    const job1 = await queue.attemptDequeue({ timeoutSecs: 30 });
    const job2 = await queue.attemptDequeue({ timeoutSecs: 30 });
    const job3 = await queue.attemptDequeue({ timeoutSecs: 30 });

    expect(job1).not.toBeNull();
    expect(job2).not.toBeNull();
    expect(job3).not.toBeNull();

    // Should maintain FIFO order for same priority
    expect(JSON.parse(job1!.payload).increment).toBe(1);
    expect(JSON.parse(job2!.payload).increment).toBe(2);
    expect(JSON.parse(job3!.payload).increment).toBe(3);
  });

  test("default priority is 0", async () => {
    const queue = new SqliteQueue<Work>(
      "default-priority-queue",
      buildDBClient(":memory:", { runMigrations: true }),
      {
        defaultJobArgs: {
          numRetries: 0,
        },
        keepFailedJobs: false,
      },
    );

    // Enqueue job without specifying priority
    const job = await queue.enqueue({ increment: 1 });

    expect(job).not.toBeUndefined();
    expect(job!.priority).toBe(0);
  });

  test("negative priorities work correctly", async () => {
    const queue = new SqliteQueue<Work>(
      "negative-priority-queue",
      buildDBClient(":memory:", { runMigrations: true }),
      {
        defaultJobArgs: {
          numRetries: 0,
        },
        keepFailedJobs: false,
      },
    );

    // Enqueue jobs with negative priorities (even higher priority than 0)
    await queue.enqueue({ increment: 1 }, { priority: 1 });
    await queue.enqueue({ increment: 2 }, { priority: -1 }); // Higher than default
    await queue.enqueue({ increment: 3 }); // Default priority (0)
    await queue.enqueue({ increment: 4 }, { priority: -2 }); // Highest priority

    const job1 = await queue.attemptDequeue({ timeoutSecs: 30 });
    const job2 = await queue.attemptDequeue({ timeoutSecs: 30 });
    const job3 = await queue.attemptDequeue({ timeoutSecs: 30 });
    const job4 = await queue.attemptDequeue({ timeoutSecs: 30 });

    expect(job1).not.toBeNull();
    expect(job2).not.toBeNull();
    expect(job3).not.toBeNull();
    expect(job4).not.toBeNull();

    // Should get -2, -1, 0, 1 in that order
    expect(JSON.parse(job1!.payload).increment).toBe(4); // priority -2
    expect(JSON.parse(job2!.payload).increment).toBe(2); // priority -1
    expect(JSON.parse(job3!.payload).increment).toBe(3); // priority 0
    expect(JSON.parse(job4!.payload).increment).toBe(1); // priority 1
  });

  test("cancelAllNonRunning cancels pending, pending_retry, and failed jobs", async () => {
    const queue = new SqliteQueue<Work>(
      "cancel-queue",
      buildDBClient(":memory:", true),
      {
        defaultJobArgs: {
          numRetries: 1,
        },
        keepFailedJobs: true,
      },
    );

    // Enqueue some jobs
    await queue.enqueue({ increment: 1 });
    await queue.enqueue({ increment: 2 });
    await queue.enqueue({ increment: 3 });

    expect(await queue.stats()).toEqual({
      pending: 3,
      running: 0,
      pending_retry: 0,
      failed: 0,
    });

    // Make one job running and one failed
    const dequeuedJob = await queue.attemptDequeue({ timeoutSecs: 30 });
    expect(dequeuedJob).not.toBeNull();
    await queue.finalize(dequeuedJob!.id, dequeuedJob!.allocationId, "failed");

    expect(await queue.stats()).toEqual({
      pending: 2,
      running: 0,
      pending_retry: 0,
      failed: 1,
    });

    // Cancel all non-running tasks
    const cancelledCount = await queue.cancelAllNonRunning();
    expect(cancelledCount).toBe(3); // 2 pending + 1 failed

    expect(await queue.stats()).toEqual({
      pending: 0,
      running: 0,
      pending_retry: 0,
      failed: 0,
    });
  });

  test("cancelAllNonRunning does not affect running jobs", async () => {
    const queue = new SqliteQueue<Work>(
      "cancel-running-queue",
      buildDBClient(":memory:", true),
      {
        defaultJobArgs: {
          numRetries: 0,
        },
        keepFailedJobs: false,
      },
    );

    // Enqueue jobs
    await queue.enqueue({ increment: 1 });
    await queue.enqueue({ increment: 2 });

    // Dequeue one job (making it running)
    const runningJob = await queue.attemptDequeue({ timeoutSecs: 30 });
    expect(runningJob).not.toBeNull();

    expect(await queue.stats()).toEqual({
      pending: 1,
      running: 1,
      pending_retry: 0,
      failed: 0,
    });

    // Cancel all non-running tasks
    const cancelledCount = await queue.cancelAllNonRunning();
    expect(cancelledCount).toBe(1); // Only the pending job

    expect(await queue.stats()).toEqual({
      pending: 0,
      running: 1, // Running job remains
      pending_retry: 0,
      failed: 0,
    });
  });

  test("cancelAllNonRunning only affects the specific queue", async () => {
    const db = buildDBClient(":memory:", true);
    const queue1 = new SqliteQueue<Work>("queue1", db, {
      defaultJobArgs: { numRetries: 0 },
      keepFailedJobs: false,
    });
    const queue2 = new SqliteQueue<Work>("queue2", db, {
      defaultJobArgs: { numRetries: 0 },
      keepFailedJobs: false,
    });

    // Add jobs to both queues
    await queue1.enqueue({ increment: 1 });
    await queue1.enqueue({ increment: 2 });
    await queue2.enqueue({ increment: 3 });
    await queue2.enqueue({ increment: 4 });

    expect(await queue1.stats()).toEqual({
      pending: 2,
      running: 0,
      pending_retry: 0,
      failed: 0,
    });
    expect(await queue2.stats()).toEqual({
      pending: 2,
      running: 0,
      pending_retry: 0,
      failed: 0,
    });

    // Cancel only queue1's tasks
    const cancelledCount = await queue1.cancelAllNonRunning();
    expect(cancelledCount).toBe(2);

    expect(await queue1.stats()).toEqual({
      pending: 0,
      running: 0,
      pending_retry: 0,
      failed: 0,
    });
    expect(await queue2.stats()).toEqual({
      pending: 2, // queue2 tasks remain untouched
      running: 0,
      pending_retry: 0,
      failed: 0,
    });
  });

  test("cancelAllNonRunning returns 0 when no tasks to cancel", async () => {
    const queue = new SqliteQueue<Work>(
      "empty-cancel-queue",
      buildDBClient(":memory:", true),
      {
        defaultJobArgs: {
          numRetries: 0,
        },
        keepFailedJobs: false,
      },
    );

    const cancelledCount = await queue.cancelAllNonRunning();
    expect(cancelledCount).toBe(0);

    expect(await queue.stats()).toEqual({
      pending: 0,
      running: 0,
      pending_retry: 0,
      failed: 0,
    });
  });

  test("cancelAllNonRunning handles pending_retry status", async () => {
    const queue = new SqliteQueue<Work>(
      "retry-cancel-queue",
      buildDBClient(":memory:", true),
      {
        defaultJobArgs: {
          numRetries: 2,
        },
        keepFailedJobs: false,
      },
    );

    // Enqueue a job
    const job = await queue.enqueue({ increment: 1 });
    expect(job).not.toBeUndefined();

    // Dequeue and mark as pending_retry
    const dequeuedJob = await queue.attemptDequeue({ timeoutSecs: 30 });
    expect(dequeuedJob).not.toBeNull();
    await queue.finalize(
      dequeuedJob!.id,
      dequeuedJob!.allocationId,
      "pending_retry",
    );

    expect(await queue.stats()).toEqual({
      pending: 0,
      running: 0,
      pending_retry: 1,
      failed: 0,
    });

    // Cancel all non-running tasks
    const cancelledCount = await queue.cancelAllNonRunning();
    expect(cancelledCount).toBe(1);

    expect(await queue.stats()).toEqual({
      pending: 0,
      running: 0,
      pending_retry: 0,
      failed: 0,
    });
  });
});
