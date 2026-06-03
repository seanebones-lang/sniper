/**
 * Cycle-aware runner heartbeat thresholds.
 * `lastRun` updates only when a cycle finishes, so age includes inter-cycle
 * delay plus any in-flight cycle time — not just the configured interval.
 */
export function getRunnerMaxCycleAgeMs(
  intervalMs: number,
  lastCycleDurationMs: number | null | undefined,
): number {
  const estimatedCycleMs = lastCycleDurationMs ?? 120_000;
  const interCycleGap = estimatedCycleMs + Math.max(intervalMs, estimatedCycleMs);
  return Math.max(intervalMs * 4, interCycleGap + 30_000);
}
