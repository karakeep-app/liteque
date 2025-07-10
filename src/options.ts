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
}

export interface RunnerFuncs<T> {
  run: (job: DequeuedJob<T>) => Promise<void>;
  onComplete?: (job: DequeuedJob<T>) => Promise<void>;
  onError?: (job: DequeuedJobError<T>) => Promise<void>;
}

export interface RunnerOptions<T> {
  pollIntervalMs: number;
  timeoutSecs: number;
  concurrency: number;
  validator?: ZodType<T>;
}
