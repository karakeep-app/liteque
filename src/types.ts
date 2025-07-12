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
