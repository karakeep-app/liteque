export interface DequeuedJob<T> {
  id: string;
  data: T;
  priority: number;
  runNumber: number;
  abortSignal: AbortSignal;
}

export interface DequeuedJobError<T> {
  id: string;
  data?: T;
  priority: number;
  error: Error;
  runNumber: number;
  numRetriesLeft: number;
}

/**
 * Error that signals the runner to re-enqueue the job after a delay.
 * This does NOT consume a retry attempt.
 */
export class RetryAfterError extends Error {
  readonly delayMs: number;

  constructor(delayMs: number) {
    super("RetryAfter");
    this.delayMs = delayMs;
  }
}
