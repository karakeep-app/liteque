# Liteque

![GitHub Actions Workflow Status](https://img.shields.io/github/actions/workflow/status/hoarder-app/liteque/ci.yml) ![NPM Version](https://img.shields.io/npm/v/liteque)


A simple typesafe sqlite-based job queue for Node.js.

## Installation

```bash
$ npm install liteque
```

## Usage

```ts
import { buildDBClient, Runner, SqliteQueue } from "liteque";
import { z } from "zod";

const db = buildDBClient(":memory:", {
  runMigrations: true,
});

const requestSchema = z.object({
    message: z.string(),
});
const ZRequest = z.infer<typeof requestSchema>;

// Init the queue
const queue = new SqliteQueue<ZRequest>("requests", db, {
    defaultJobArgs: {
        numRetries: 2,
    },
    keepFailedJobs: false,
});

// Enqueue a job
await queue.enqueue({
    message: "Hello world",
});

// Start the runner
const worker = new Runner<ZRequest>(
  queue,
  {
    run: async (job) => {
      logger.info(`[${job.id}] ${job.data.message}`);
    },
    onComplete: async (job) => {
      console.log(`[${job.id}] Completed successfully`);
    },
    onError: async (job) => {
      logger.error(
        `[${job.id}] job failed: ${job.error}\n${job.error.stack}`,
      );
    },
  },
  {
    concurrency: 1,
    pollIntervalMs: 1000,
    timeoutSecs: 60,
    validator: requestSchema,
  },
);

```

### Sharing a polling loop

Queues backed by the same database can share one polling loop while keeping
separate handlers, validators, timeouts, and concurrency limits:

```ts
import { RunnerPool } from "liteque";

const pool = new RunnerPool(db, { pollIntervalMs: 1000 })
  .register(
    requestQueue,
    { run: async (job) => handleRequest(job.data) },
    {
      concurrency: 2,
      timeoutSecs: 60,
      validator: requestSchema,
    },
  )
  .register(
    cleanupQueue,
    { run: async (job) => cleanUp(job.data) },
    {
      concurrency: 1,
      timeoutSecs: 30,
      validator: cleanupSchema,
    },
  );

await pool.run();
```

When the queues are idle, the pool performs one cross-queue dequeue attempt per
poll interval instead of one attempt per queue.

## Development

```base
$ pnpm install

# And before submitting a PR

$ pnpm typecheck
$ pnpm test
```
