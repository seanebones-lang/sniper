/**
 * Runner stall detection — alert when cycles stop while runner claims running.
 */
import { getRunnerStatus, getRunnerIntervalMs } from '@/lib/runner/engine';

let lastStallAlertAt = 0;
const ALERT_INTERVAL_MS = 10 * 60 * 1000;

export async function checkRunnerStall(): Promise<boolean> {
  const runner = getRunnerStatus();
  if (!runner.running) return false;

  const intervalMs = await getRunnerIntervalMs();
  const maxAgeMs = intervalMs * 2.5;
  const lastRunAge =
    runner.lastRun != null ? Date.now() - new Date(runner.lastRun).getTime() : Infinity;

  if (lastRunAge <= maxAgeMs) return false;

  const now = Date.now();
  if (now - lastStallAlertAt < ALERT_INTERVAL_MS) return true;
  lastStallAlertAt = now;

  try {
    const { sendCriticalAlert } = await import('@/lib/alerts/critical');
    await sendCriticalAlert(
      `Runner stall: running=true but no cycle for ${Math.round(lastRunAge / 1000)}s (max ${Math.round(maxAgeMs / 1000)}s)`,
    );
  } catch {
    console.warn('[RunnerStall] Runner appears stalled');
  }
  return true;
}
