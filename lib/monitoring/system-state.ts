/**
 * Durable System State Service
 *
 * For responsible 24/7 real capital operation, critical safety and risk state
 * MUST survive process restarts, deploys, and crashes.
 *
 * This service provides a minimal, auditable key/value store backed by the
 * `system_state` table. All mutations emit audit_events.
 *
 * Usage priority (highest impact first):
 * - kill_switch
 * - risk_mode
 * - daily_loss
 * - execution_health (summary)
 */

import { db, systemState, auditEvents } from '@/lib/db';
import { eq, sql } from 'drizzle-orm';

export type SystemStateKey =
  | 'kill_switch'
  | 'risk_mode'
  | 'daily_loss'
  | 'execution_health_summary'
  | 'risk_snapshot'
  | 'runner_lock'
  | 'runner_control'
  | 'strategy_variants'
  | 'polymarket_http_proxy'
  | 'polymarket_browser_session'
  | 'paper_budget_settings'
  | 'live_self_heal'
  | 'live_intelligence'
  | 'live_session_bankroll'
  | 'live_trade_outcomes'
  | 'live_gate_stats';

export interface KillSwitchState {
  disabled: boolean;
  reason: string;
  disabledAt: string; // ISO
  disabledBy: 'env' | 'runtime' | 'system';
}

export interface RiskModeState {
  current: 'NORMAL' | 'DEFENSIVE' | 'EMERGENCY';
  reason: string;
  enteredAt: string;
}

export interface DailyLossState {
  trackedUsd: number;
  lastResetAt: string;
}

const AUDIT_ACTOR = 'system-state';

/** Throttle persistence-failure alerts so a DB outage doesn't spam Telegram. */
let lastPersistFailureAlertAt = 0;
const PERSIST_FAILURE_ALERT_INTERVAL_MS = 5 * 60 * 1000;

async function alertPersistFailure(key: SystemStateKey, err: unknown) {
  console.error(`[SystemState] FAILED to persist '${key}' — durable safety state may be stale`, err);
  const now = Date.now();
  if (now - lastPersistFailureAlertAt < PERSIST_FAILURE_ALERT_INTERVAL_MS) return;
  lastPersistFailureAlertAt = now;
  try {
    const { sendCriticalAlert } = await import('@/lib/alerts/critical');
    await sendCriticalAlert(
      `Durable state write failed for '${key}'. Kill-switch / risk-mode / daily-loss may not survive a restart. Check the DB.`,
      { key, error: err instanceof Error ? err.message : String(err) },
    );
  } catch {
    // alerting is best-effort
  }
}

async function logAudit(action: string, payload: Record<string, unknown>) {
  try {
    await db.insert(auditEvents).values({
      actor: AUDIT_ACTOR,
      action,
      payload,
    });
  } catch {
    // Best effort — never let auditing break state persistence
  }
}

/**
 * Persist a piece of critical system state.
 * Always emits an audit event.
 * DB failures are swallowed (best-effort durability) so the safety system never breaks callers.
 */
export async function persistSystemState(
  key: SystemStateKey,
  value: any,
  reason?: string
): Promise<void> {
  try {
    await db
      .insert(systemState)
      .values({
        key,
        value,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: systemState.key,
        set: {
          value,
          updatedAt: new Date(),
        },
      });

    await logAudit('system_state_persisted', {
      key,
      value,
      reason: reason || 'state change',
    });
  } catch (err) {
    // Best effort — in-memory cache in callers still works — but a failure to
    // persist critical safety state is dangerous (it won't survive a restart),
    // so surface it instead of swallowing silently.
    void alertPersistFailure(key, err);
  }
}

/**
 * Load a piece of persisted system state (or null if never set).
 * DB failures return null (safe default behavior in callers).
 */
export async function loadSystemState<T = Record<string, unknown>>(
  key: SystemStateKey
): Promise<T | null> {
  try {
    const row = await db.query.systemState.findFirst({
      where: eq(systemState.key, key),
    });
    return (row?.value as T) ?? null;
  } catch {
    return null;
  }
}

/**
 * Convenience: Load the kill switch state.
 * Returns a safe default (enabled) if nothing is persisted.
 */
export async function loadKillSwitchState(): Promise<KillSwitchState> {
  const persisted = await loadSystemState<KillSwitchState>('kill_switch');
  if (persisted) return persisted;

  return {
    disabled: false,
    reason: 'No persisted state — defaulting to enabled (subject to env)',
    disabledAt: new Date(0).toISOString(),
    disabledBy: 'system',
  };
}

/**
 * Convenience: Disable the kill switch durably.
 */
export async function persistKillSwitchDisabled(reason: string, disabledBy: 'env' | 'runtime' | 'system' = 'runtime') {
  const state: KillSwitchState = {
    disabled: true,
    reason,
    disabledAt: new Date().toISOString(),
    disabledBy,
  };
  await persistSystemState('kill_switch', state, reason);
  return state;
}

/**
 * Convenience: Re-enable (clear) the runtime kill switch.
 * Note: SNIPER_DISABLE_REAL_EXECUTION env var still takes precedence.
 */
export async function persistKillSwitchEnabled(reason: string) {
  const state: KillSwitchState = {
    disabled: false,
    reason,
    disabledAt: new Date(0).toISOString(),
    disabledBy: 'system',
  };
  await persistSystemState('kill_switch', state, reason);
  return state;
}

/**
 * Load all critical safety state on runner startup.
 * Returns a summary object for logging.
 */
export async function loadCriticalSafetyState() {
  const [killSwitch, riskMode, dailyLoss] = await Promise.all([
    loadKillSwitchState(),
    loadSystemState<RiskModeState>('risk_mode'),
    loadSystemState<DailyLossState>('daily_loss'),
  ]);

  return {
    killSwitch,
    riskMode: riskMode || { current: 'NORMAL', reason: 'No persisted state' },
    dailyLoss: dailyLoss || { trackedUsd: 0, lastResetAt: new Date(0).toISOString() },
  };
}

export interface ExecutionHealthSummary {
  systemHealthScore: number;
  unhealthyMarketCount: number;
  recentAdverseRate: number;
  lastUpdated: string;
}

export async function persistExecutionHealth(summary: ExecutionHealthSummary, reason?: string) {
  await persistSystemState('execution_health_summary', summary as any, reason || 'periodic health snapshot');
}

export interface RiskSnapshot {
  totalExposureUsd: number;
  openPositions: number;
  currentRiskMode: string;
  systemHealthScore: number;
  adverseRate: number;
  currentBankroll?: number;
  maxDrawdown?: number;
  snapshotAt: string;
}

export async function persistRiskSnapshot(snapshot: RiskSnapshot, reason?: string) {
  await persistSystemState('risk_snapshot', snapshot as any, reason || 'runner cycle risk snapshot');
}

export async function loadRiskSnapshot(): Promise<RiskSnapshot | null> {
  return loadSystemState<RiskSnapshot>('risk_snapshot');
}

/**
 * Single-runner lock (lease + heartbeat).
 *
 * Prevents two runner loops (Railway rolling-deploy overlap or a scaled replica)
 * from trading the same DB simultaneously. The lease lives in `system_state` and
 * is atomically acquired/refreshed: the ON CONFLICT update only succeeds when the
 * caller already owns the lease or the existing lease's heartbeat is stale.
 */
const RUNNER_LOCK_KEY = 'runner_lock';

/**
 * Try to acquire (or refresh, if already owned) the runner lock.
 * @param failOpen returned on DB error — true for paper (tolerate), false for
 *   real money (never risk two live loops).
 */
export async function tryAcquireRunnerLock(
  instanceId: string,
  ttlMs = 60_000,
  failOpen = false,
): Promise<boolean> {
  const now = Date.now();
  const staleBefore = now - ttlMs;
  const futureSkewMs = 60_000;
  try {
    const result = await db.execute(sql`
      INSERT INTO system_state (key, value, updated_at)
      VALUES (
        ${RUNNER_LOCK_KEY},
        jsonb_build_object('owner', ${instanceId}::text, 'heartbeatAt', ${now}::bigint),
        now()
      )
      ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, updated_at = now()
        WHERE (system_state.value->>'owner') = ${instanceId}
           OR COALESCE((system_state.value->>'heartbeatAt')::bigint, 0) < ${staleBefore}
           OR COALESCE((system_state.value->>'heartbeatAt')::bigint, 0) > ${now + futureSkewMs}
      RETURNING (value->>'owner') AS owner
    `);
    const rows = result as unknown as { length?: number; rowCount?: number };
    if (typeof rows.length === 'number') return rows.length > 0;
    if (typeof rows.rowCount === 'number') return rows.rowCount > 0;
    return false;
  } catch {
    return failOpen;
  }
}

/** Release the runner lock if (and only if) this instance owns it. */
export async function releaseRunnerLock(instanceId: string): Promise<void> {
  try {
    await db.execute(sql`
      DELETE FROM system_state
      WHERE key = ${RUNNER_LOCK_KEY} AND (value->>'owner') = ${instanceId}
    `);
  } catch {
    // best effort — a stale lease will expire via TTL anyway
  }
}
