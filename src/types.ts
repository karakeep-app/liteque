export interface DequeuedJob<T> {
  id: string;
  data: T;
  runNumber: number;
  abortSignal: AbortSignal;
}

export interface DequeuedJobError<T> {
  id: string;
  data?: T;
  error: Error;
  runNumber: number;
  numRetriesLeft: number;
}
