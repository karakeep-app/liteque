import { describe, expect, test } from "vitest";
import { z } from "zod";

import { RunnerPool, SqliteQueue, buildDBClient } from "./";

const queueOptions = {
  defaultJobArgs: {
    numRetries: 0,
  },
  keepFailedJobs: true,
};

describe("RunnerPool", () => {
  test("runs independently typed queues from one pool", async () => {
    const db = buildDBClient(":memory:", { runMigrations: true });
    const emailQueue = new SqliteQueue<{ recipient: string }>(
      "emails",
      db,
      queueOptions,
    );
    const cleanupQueue = new SqliteQueue<{ path: string }>(
      "cleanup",
      db,
      queueOptions,
    );

    await emailQueue.enqueue({ recipient: "one@example.com" });
    await cleanupQueue.enqueue({ path: "/tmp/one" });

    const handled: string[] = [];
    const pool = new RunnerPool(db, { pollIntervalMs: 10 })
      .register(
        emailQueue,
        {
          run: async (job) => {
            handled.push(`email:${job.data.recipient}`);
          },
        },
        {
          concurrency: 1,
          timeoutSecs: 30,
          validator: z.object({ recipient: z.string() }),
        },
      )
      .register(
        cleanupQueue,
        {
          run: async (job) => {
            handled.push(`cleanup:${job.data.path}`);
          },
        },
        {
          concurrency: 1,
          timeoutSecs: 30,
          validator: z.object({ path: z.string() }),
        },
      );

    await pool.runUntilEmpty();

    expect(handled).toEqual(["email:one@example.com", "cleanup:/tmp/one"]);
    expect(await emailQueue.stats()).toEqual({
      pending: 0,
      pending_retry: 0,
      running: 0,
      failed: 0,
    });
    expect(await cleanupQueue.stats()).toEqual({
      pending: 0,
      pending_retry: 0,
      running: 0,
      failed: 0,
    });
  });

  test("preserves concurrency limits for each queue", async () => {
    const db = buildDBClient(":memory:", { runMigrations: true });
    const serialQueue = new SqliteQueue<number>("serial", db, queueOptions);
    const concurrentQueue = new SqliteQueue<number>(
      "concurrent",
      db,
      queueOptions,
    );
    for (let index = 0; index < 4; index++) {
      await serialQueue.enqueue(index);
      await concurrentQueue.enqueue(index);
    }

    const active = { serial: 0, concurrent: 0 };
    const maxActive = { serial: 0, concurrent: 0 };
    const run = async (queueName: keyof typeof active) => {
      active[queueName]++;
      maxActive[queueName] = Math.max(maxActive[queueName], active[queueName]);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active[queueName]--;
    };

    const pool = new RunnerPool(db, { pollIntervalMs: 10 })
      .register(
        serialQueue,
        { run: async () => await run("serial") },
        { concurrency: 1, timeoutSecs: 30 },
      )
      .register(
        concurrentQueue,
        { run: async () => await run("concurrent") },
        { concurrency: 2, timeoutSecs: 30 },
      );

    await pool.runUntilEmpty();

    expect(maxActive.serial).toBe(1);
    expect(maxActive.concurrent).toBe(2);
  });

  test("stop interrupts an idle poll wait", async () => {
    const db = buildDBClient(":memory:", { runMigrations: true });
    const queue = new SqliteQueue<number>("idle", db, queueOptions);
    const pool = new RunnerPool(db, { pollIntervalMs: 10_000 }).register(
      queue,
      { run: async () => {} },
      { concurrency: 1, timeoutSecs: 30 },
    );

    const runPromise = pool.run();
    await new Promise((resolve) => setTimeout(resolve, 10));
    pool.stop();

    await runPromise;
  });

  test("rejects queues backed by a different database", () => {
    const poolDb = buildDBClient(":memory:", { runMigrations: true });
    const queueDb = buildDBClient(":memory:", { runMigrations: true });
    const queue = new SqliteQueue<number>("other-db", queueDb, queueOptions);
    const pool = new RunnerPool(poolDb, { pollIntervalMs: 10 });

    expect(() =>
      pool.register(
        queue,
        { run: async () => {} },
        { concurrency: 1, timeoutSecs: 30 },
      ),
    ).toThrow("All queues in a RunnerPool must use the pool's database");
  });
});
