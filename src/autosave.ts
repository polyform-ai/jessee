export function autosaveRetryDelay(failureCount: number): number {
  return Math.min(30_000, 1_500 * (2 ** Math.max(0, failureCount)));
}

export function shouldFlushPendingAutosave(isDirty: boolean, hasPendingAction: boolean): boolean {
  return isDirty && !hasPendingAction;
}
