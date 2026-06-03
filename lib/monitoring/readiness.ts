/**
 * Readiness checks — DB, runner heartbeat, reconciliation backlog.
 */
import { db, realTrades } from '@/lib/db';
import { eq, sql } from 'drizzle-orm';
import { getRunnerStatus, getRunnerIntervalMs } from '@/lib/runner/engine';
import { getRunnerMaxCycleAgeMs } from '@/lib/monitoring/runner-heartbeat';
import { isRealExecutionAllowed } from '@/lib/execution/real-executor';
import { loadKillSwitchState, loadSystemState } from '@/lib/monitoring/system-state';

export interface ReadinessResult {
  ready: boolean;
  checks: Record<string, { ok: boolean; detail?: string }>;
}

export async function computeReadiness(): Promise<ReadinessResult> {
  const checks: ReadinessResult['checks'] = {};

  try {
    await db.execute(sql`SELECT 1`);
    checks.database = { ok: true };
  } catch (e) {
    checks.database = {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }

  const runner = getRunnerStatus();
  const intervalMs = await getRunnerIntervalMs();
  const maxAgeMs = getRunnerMaxCycleAgeMs(intervalMs, runner.lastCycleDurationMs);
  const lastRunAge =
    runner.lastRun != null ? Date.now() - new Date(runner.lastRun).getTime() : Infinity;

  if (!runner.running) {
    checks.runner = { ok: false, detail: 'Runner not running' };
  } else if (lastRunAge > maxAgeMs) {
    checks.runner = {
      ok: false,
      detail: `Last cycle ${Math.round(lastRunAge / 1000)}s ago (max ${Math.round(maxAgeMs / 1000)}s)`,
    };
  } else {
    checks.runner = { ok: true, detail: `Last cycle ${Math.round(lastRunAge / 1000)}s ago` };
  }

  const needsReview = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(realTrades)
    .where(eq(realTrades.status, 'needs_review'));
  const reviewCount = needsReview[0]?.cnt ?? 0;
  checks.reconciliation = {
    ok: reviewCount < 5,
    detail: `${reviewCount} needs_review`,
  };

  const kill = await loadKillSwitchState();
  checks.killSwitch = {
    ok: !kill.disabled,
    detail: kill.disabled ? kill.reason : 'enabled',
  };

  const lock = await loadSystemState<{ owner?: string; heartbeatAt?: number }>('runner_lock');
  checks.runnerLock = {
    ok: true,
    detail: lock?.owner ?? 'none',
  };

  const realEnabled = process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true';
  if (realEnabled) {
    const allowed = await isRealExecutionAllowed();
    checks.realExecution = {
      ok: allowed,
      detail: allowed ? 'allowed' : 'blocked',
    };
    const hasTelegram =
      !!process.env.TELEGRAM_BOT_TOKEN?.trim() && !!process.env.TELEGRAM_CHAT_ID?.trim();
    checks.alertChannel = {
      ok: hasTelegram,
      detail: hasTelegram ? 'telegram configured' : 'no TELEGRAM_* — alerts silent',
    };
  }

  const blockingKeys = [
    'database',
    'runner',
    'reconciliation',
    'killSwitch',
    'runnerLock',
    ...(realEnabled ? (['realExecution'] as const) : []),
  ];
  const ready = blockingKeys.every((k) => checks[k]?.ok);
  return { ready, checks };
}
