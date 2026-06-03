/**
 * Cycle-aware runner heartbeat thresholds.
 * Long cycles (book fetches) schedule the next run after lastCycleDurationMs,
 * so stall detection must not use intervalMs alone.
 */
export function getRunnerMaxCycleAgeMs(
  intervalMs: number,
  lastCycleDurationMs: number | null | undefined,
): number {
  const cycleMs = lastCycleDurationMs ?? intervalMs;
  const scheduledGap = cycleMs + Math.max(intervalMs, cycleMs);
  return Math.max(intervalMs * 4, scheduledGap + 45_000);
}
