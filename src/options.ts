import { ZodType } from "zod";

import { DequeuedJob, DequeuedJobError } from "./types";

export interface SqliteQueueOptions {
  defaultJobArgs: {
    numRetries: number;
  };
  keepFailedJobs: boolean;
}

export interface EnqueueOptions {
  numRetries?: number;
  idempotencyKey?: string;
  priority?: number;
  /** delay the job by this many milliseconds. */
  delayMs?: number;
}

export interface RunnerFuncs<T, R = void> {
  run: (job: DequeuedJob<T>) => Promise<R>;
  onComplete?: (job: DequeuedJob<T>, result: R) => Promise<void>;
  onError?: (job: DequeuedJobError<T>) => Promise<void>;
}

export interface RunnerOptions<T> {
  pollIntervalMs: number;
  timeoutSecs: number;
  concurrency: number;
  validator?: ZodType<T>;
}
