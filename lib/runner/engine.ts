/**
 * Strategy Engine + Background Runner (Phase 3)
 * This is the core that makes the system "know when to buy and sell".
 *
 * Arch note: ~580 LOC orchestrates riskMode, portfolioRisk, executionManager, recon, Grok agent, snapshots, dynamic alloc.
 * If adding significantly more (e.g. full WS strategies), consider splitting into RiskOrchestrator + EvaluationLoop.
 */

import { db, signals, auditEvents, strategies } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { getAllMarkets, getMarketsForQuickFlip, getMarketsForLiveNearTerm, getMarketsForBtcSniper } from '@/lib/markets';
import { getStrategy } from '@/lib/strategies';
import { paperSimulator } from '@/lib/execution/paper-simulator';
import type { Market } from '@/lib/types';
import type { StrategyConfig } from '@/lib/strategies/types';
import { resolveStrategyConfigForType, resolveStrategyImplType, shouldUseImmediateFill, type ResolvedStrategyConfig } from '@/lib/strategies/run-profile';
import { getOpenPositionsByStrategy, hydratePaperSimulatorFromDb } from '@/lib/paper/strategy-positions';
import { persistPaperFill } from '@/lib/paper/record-fill';
import { countRunnerSessionStats } from '@/lib/runner/session-counters';
import { getRealOpenPositionsByStrategy } from '@/lib/execution/real-positions';
import { alerts } from '@/lib/alerts/telegram';
import { portfolioRiskManager } from '@/lib/risk/portfolio-manager';
import { rankQuickFlipMarkets, filterQuickFlipMarkets, QUICK_FLIP_MAX_RESOLUTION_HOURS, filterLiveResolutionMarkets, LIVE_MAX_RESOLUTION_HOURS } from '@/lib/markets/fast-moving';
import { filterBtcSniperMarkets, rankBtcSniperMarkets } from '@/lib/markets/btc-sniper';
import { clearParentSignalCache } from '@/lib/btc/signal-engine';
import { fetchBtcUsdtCloses } from '@/lib/clients/ccxt-binance';
import { setBtcSniperBookCache } from '@/lib/strategies/btc-sniper';
import { getDynamicAllocations } from '@/lib/strategies/allocator';
import { getRecentSnapshotsBatch } from '@/lib/data/historical';
import { executionManager } from '@/lib/execution/execution-manager';
import { edgeDecayMonitor } from '@/lib/monitoring/edge-decay';
import { riskModeManager, type RiskMode } from '@/lib/monitoring/risk-mode';
import { storeRecommendations } from '@/lib/monitoring/ai-recommendations';
import { loadPaperRiskState } from '@/lib/paper/risk-state';
import {
  computeStrategyPnlWindows,
  statsToPerformanceWindow,
} from '@/lib/research/strategy-attribution';
import { CycleBookCache } from '@/lib/runner/book-cache';
import { getRunnerBookHub } from '@/lib/runner/book-hub';
import { 
  applyTemporaryAdjustment, 
  cleanupExpiredAdjustments, 
  getEffectiveGlobalRiskMultiplier,
  incrementRunCount,
  getCurrentRunCount,
} from '@/lib/monitoring/temporary-adjustments';
import {
  evaluateMarketForStrategy,
  type EvaluateMarketContext,
  type QueuedRunnerSignal,
} from '@/lib/runner/evaluate-market';
import { runPool } from '@/lib/runner/parallel-pool';

/** Live quick-flip market sample — smaller in DEFENSIVE/micro to keep cycles fast. */
function resolveQuickFlipMarketLimit(riskMode: RiskMode, liveMicro: boolean): number {
  if (riskMode === 'EMERGENCY') return 8;
  if (riskMode === 'DEFENSIVE') return liveMicro ? 12 : 16;
  return liveMicro ? 24 : 40;
}

/** Spread-capture scans more markets and prioritizes the widest books. */
const SPREAD_CAPTURE_EVAL_LIMIT = 50;

/** BTC sniper: small pool, fast cycles (slug windows only). */
const BTC_SNIPER_EVAL_LIMIT = 10;

function isBtcSniperStrategy(
  config: Pick<ResolvedStrategyConfig, 'tradingGoal'>,
  type: string,
): boolean {
  return type === 'btc-sniper' || config.tradingGoal === 'btc-momentum';
}

function isSpreadCaptureStrategy(
  config: Pick<ResolvedStrategyConfig, 'tradingGoal'>,
  type: string,
): boolean {
  return config.tradingGoal === 'spread-capture' || type === 'spread-scalper';
}

function rankMarketsBySpreadWidth(markets: Market[], bookCache: CycleBookCache): Market[] {
  return [...markets]
    .map((m) => {
      const book = bookCache.getBook(m.platform, m.externalId);
      if (!book?.bids?.length || !book?.asks?.length) return { m, spreadPct: -1 };
      const spread = book.spread ?? book.asks[0].price - book.bids[0].price;
      const mid = book.mid ?? (book.asks[0].price + book.bids[0].price) / 2;
      const spreadPct = mid > 0 ? (spread / mid) * 100 : -1;
      return { m, spreadPct };
    })
    .filter((x) => x.spreadPct > 0)
    .sort((a, b) => b.spreadPct - a.spreadPct)
    .map((x) => x.m);
}

export interface ActiveStrategyProfile {
  id: string;
  name: string;
  type: string;
  tradingStyle: string;
  tradingGoal: string;
  maxSizeUsd: number;
  cooldownSeconds: number;
  aggressiveEntryFills: boolean;
}

export interface RunnerCycleDiagnostics {
  at: string;
  marketPoolSize: number;
  eligibleQuickFlipMarkets: number;
  marketsEvaluated: number;
  signalsThisCycle: number;
  fillsThisCycle: number;
  skipReason: string | null;
  riskMode: string;
  activeProfiles: ActiveStrategyProfile[];
  bookFetch?: {
    wsHits: number;
    restFetched: number;
    watchlistSize: number;
    polyConnected: boolean;
    kalshiConnected: boolean;
  };
}

export interface RunnerStatus {
  running: boolean;
  lastRun: string | null;
  signalsGenerated: number;
  fillsExecuted: number;
  lastCycle: RunnerCycleDiagnostics | null;
  lastCycleDurationMs: number | null;
}

const status: RunnerStatus = {
  running: false,
  lastRun: null,
  signalsGenerated: 0,
  fillsExecuted: 0,
  lastCycle: null,
  lastCycleDurationMs: null,
};

let interval: NodeJS.Timeout | null = null;
let cycleTimeout: ReturnType<typeof setTimeout> | null = null;
let cycleInFlight = false;
let cycleInFlightSince = 0;
const MAX_CYCLE_IN_FLIGHT_MS = 180_000;

/** Stable per-process id used for the single-runner DB lease. */
const RUNNER_LOCK_TTL_MS = 60_000;
type RunnerLockGlobal = typeof globalThis & { __sniperRunnerInstanceId?: string };
const lg = globalThis as RunnerLockGlobal;
if (!lg.__sniperRunnerInstanceId) {
  lg.__sniperRunnerInstanceId = `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
}
const RUNNER_INSTANCE_ID = lg.__sniperRunnerInstanceId;
/** Last signal timestamp per strategy:market for cooldown enforcement */
const lastSignalAtByKey = new Map<string, number>();

const MARKET_EVAL_CONCURRENCY = Math.min(
  16,
  Math.max(4, parseInt(process.env.SNIPER_MARKET_EVAL_CONCURRENCY ?? '12', 10) || 12),
);

/** Persist runner singleton across Next.js dev HMR / route reloads */
type RunnerGlobal = typeof globalThis & {
  __sniperRunner?: { status: RunnerStatus; interval: NodeJS.Timeout | null };
};

const g = globalThis as RunnerGlobal;
if (!g.__sniperRunner) {
  g.__sniperRunner = { status: { ...status }, interval: null };
}
const runnerStore = g.__sniperRunner;

function syncStatusFromStore() {
  status.running = runnerStore.status.running;
  status.lastRun = runnerStore.status.lastRun;
  status.signalsGenerated = runnerStore.status.signalsGenerated;
  status.fillsExecuted = runnerStore.status.fillsExecuted;
  status.lastCycle = runnerStore.status.lastCycle ?? null;
  status.lastCycleDurationMs = runnerStore.status.lastCycleDurationMs ?? null;
  interval = runnerStore.interval;
}

function persistStatus() {
  runnerStore.status = { ...status };
  runnerStore.interval = interval;
}

syncStatusFromStore();

/** Faster loop when quick-flip strategies are active (live sports / fast markets). */
let cachedIntervalMs: { value: number; expiresAt: number } | null = null;

export async function getRunnerIntervalMs(): Promise<number> {
  const now = Date.now();
  if (cachedIntervalMs && now < cachedIntervalMs.expiresAt) {
    return cachedIntervalMs.value;
  }

  const activeStrategies = await db.query.strategies.findMany({
    where: (s, { eq }) => eq(s.isActive, true),
  });

  let value = 12000;
  for (const strat of activeStrategies) {
    const config = resolveStrategyConfigForType(strat.type, strat.config as unknown as StrategyConfig);
    if (config.tradingGoal === 'quick-flip' || strat.type === 'live-quick-flip' || strat.type === 'btc-sniper' || config.tradingGoal === 'btc-momentum') {
      value = 4000;
      break;
    }
  }

  cachedIntervalMs = { value, expiresAt: now + 30_000 };
  return value;
}

export function getRunnerStatus(): RunnerStatus {
  syncStatusFromStore();
  return { ...status };
}

/** Reset in-process counters for a new paper run (DB unchanged). */
export function resetRunnerSessionCounters() {
  syncStatusFromStore();
  status.signalsGenerated = 0;
  status.fillsExecuted = 0;
  status.lastRun = null;
  persistStatus();
}

/** Align in-memory counters with DB for the current paper run window. */
async function syncRunnerSessionCountersFromDb() {
  const { signals: sigCount, fills: fillCount } = await countRunnerSessionStats();
  status.signalsGenerated = sigCount;
  status.fillsExecuted = fillCount;
  persistStatus();
}

export async function startRunner(intervalMs = 15000) {
  syncStatusFromStore();
  if (status.running) return;

  // Single-runner lock: never let two loops trade the same DB. Fail closed when
  // real execution is enabled (a duplicate live loop is dangerous), fail open
  // for paper so a transient DB blip doesn't halt research.
  const realEnabledAtStart = process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true';
  try {
    const { tryAcquireRunnerLock } = await import('@/lib/monitoring/system-state');
    const acquired = await tryAcquireRunnerLock(
      RUNNER_INSTANCE_ID,
      RUNNER_LOCK_TTL_MS,
      !realEnabledAtStart,
    );
    if (!acquired) {
      console.warn(
        `[Runner] Another instance holds the runner lock — not starting the loop on this instance (${RUNNER_INSTANCE_ID}).`,
      );
      return;
    }
  } catch (e) {
    if (realEnabledAtStart) {
      console.error('[Runner] Could not acquire runner lock and real execution is enabled — refusing to start.', e);
      return;
    }
    console.warn('[Runner] Runner lock check failed (non-fatal in paper mode):', e);
  }

  const { applyPaperBudgetToRiskManager } = await import('@/lib/paper/portfolio');
  await applyPaperBudgetToRiskManager();
  await hydratePaperSimulatorFromDb();
  await syncRunnerSessionCountersFromDb();

  status.running = true;
  persistStatus();
  if (realEnabledAtStart) {
    void import('@/lib/execution/dead-market-tokens')
      .then((m) => m.hydrateRuntimeDeadMarketTokens())
      .catch(() => {});
    void import('@/lib/execution/live-self-heal')
      .then((m) => m.runLiveSelfHeal({ force: true, intervalMs: 0 }))
      .catch(() => {});
  }
  getRunnerBookHub().start();
  console.log(
    `[Runner] Starting 24/7 ${realEnabledAtStart ? 'live' : 'paper'} runner...`,
  );
  void import('@/lib/monitoring/runner-control')
    .then((m) => m.persistRunnerDesiredState('running', 'system', 'runner started'))
    .catch(() => {});

  // === Durable Safety State Recovery (critical for real capital) ===
  // We RESTORE (not just log) persisted posture so a redeploy mid-session does
  // not silently reset the runner to a fresh, over-confident NORMAL state.
  try {
    const { loadCriticalSafetyState, loadSystemState, loadRiskSnapshot } = await import('@/lib/monitoring/system-state');
    const { riskEngine } = await import('@/lib/risk/engine');
    const safety = await loadCriticalSafetyState();

    if (safety.killSwitch.disabled) {
      console.warn('🚨 [Runner] KILL SWITCH RECOVERED FROM PERSISTED STATE');
      console.warn(`   Reason: ${safety.killSwitch.reason}`);
      console.warn(`   Disabled at: ${safety.killSwitch.disabledAt}`);
    }

    // Restore risk mode into the live manager (was previously log-only).
    if (safety.riskMode.current !== 'NORMAL') {
      const enteredAt = (safety.riskMode as { enteredAt?: string }).enteredAt;
      riskModeManager.restoreState(
        safety.riskMode.current,
        `Recovered after restart: ${safety.riskMode.reason}`,
        enteredAt ? new Date(enteredAt) : undefined,
      );
      console.warn(`⚠️ [Runner] RISK MODE RESTORED: ${safety.riskMode.current} — ${safety.riskMode.reason}`);
    }

    // Restore daily-loss tracking so the breaker survives a redeploy.
    if (safety.dailyLoss.trackedUsd > 0) {
      riskEngine.restoreDailyLoss(safety.dailyLoss.trackedUsd, safety.dailyLoss.lastResetAt);
      console.warn(`[Runner] Daily-loss restored: $${safety.dailyLoss.trackedUsd.toFixed(2)} tracked`);
    }

    // Restore execution-health posture: if the last known health was poor, start
    // cautious (DEFENSIVE) until fresh fills rebuild the in-memory metrics, so we
    // don't oversize in the first cycles after a restart.
    const execHealth = await loadSystemState<any>('execution_health_summary');
    if (execHealth && typeof execHealth.systemHealthScore === 'number' && execHealth.systemHealthScore < 0.55) {
      riskModeManager.escalateAtLeast(
        'DEFENSIVE',
        `Recovered low execution health (${(execHealth.systemHealthScore * 100).toFixed(0)}%) — starting cautious`,
      );
      console.warn(`[Runner] Last execution health was low (${(execHealth.systemHealthScore * 100).toFixed(0)}%); starting in DEFENSIVE until metrics rebuild`);
    }

    // Restore the drawdown high-water mark + posture from the last rich snapshot.
    const lastRisk = await loadRiskSnapshot();
    if (lastRisk) {
      console.log(`[Runner] Recovered risk snapshot from ${lastRisk.snapshotAt}: Exposure $${lastRisk.totalExposureUsd.toFixed(0)} | Mode: ${lastRisk.currentRiskMode} | Health: ${(lastRisk.systemHealthScore * 100).toFixed(1)}%`);

      const liveAtStart = process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true';
      if (liveAtStart && lastRisk.totalExposureUsd > 500) {
        // Ignore paper-era snapshot on live micro accounts.
        portfolioRiskManager.resetDrawdown();
      } else {
        portfolioRiskManager.restoreDrawdownState(lastRisk.currentBankroll, lastRisk.maxDrawdown);
      }

      if (
        lastRisk.systemHealthScore < 0.55 ||
        (!liveAtStart && lastRisk.totalExposureUsd > 1200)
      ) {
        console.warn('⚠️ [Runner] STARTUP WARNING: Last known risk state was elevated. Starting with extra caution.');
        riskModeManager.escalateAtLeast('DEFENSIVE', 'Recovered elevated risk posture');
        await logAudit('startup_elevated_risk_state', {
          snapshot: lastRisk,
          note: 'Runner is starting from a previously stressed risk posture',
        });
      }
    }
  } catch (e) {
    console.warn('[Runner] Could not load durable safety state (non-fatal):', e);
  }

  // Don't route startup setup through the metered proxy unless a live strategy
  // is actually active — a paper soak boots and reads direct.
  try {
    const liveStrategyActive =
      process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true' &&
      (
        await db.query.strategies.findMany({
          where: (s, { and, eq }) => and(eq(s.isActive, true), eq(s.paperOnly, false)),
          columns: { id: true },
          limit: 1,
        })
      ).length > 0;
    const { setPolymarketProxyEgressEnabled } = await import('@/lib/clients/polymarket-http-proxy');
    setPolymarketProxyEgressEnabled(liveStrategyActive);
  } catch {
    // Non-fatal.
  }

  if (process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true') {
    try {
      const { checkPolymarketGeoblock, formatGeoblockMessage } = await import(
        '@/lib/clients/polymarket-geoblock'
      );
      const geo = await checkPolymarketGeoblock({ force: true, ignoreSkip: true });
      if (geo.blocked) {
        console.warn(`[Runner] ${formatGeoblockMessage(geo)}`);
      }
    } catch (e) {
      console.warn('[Runner] Geoblock check failed (non-fatal):', e);
    }
    try {
      const { ensurePolymarketTradingReady } = await import(
        '@/lib/clients/polymarket-trading-setup'
      );
      const setup = await ensurePolymarketTradingReady({ force: true });
      console.log(
        `[Runner] Polymarket auto-setup: ready=${setup.ready} balance=$${setup.balanceUsd?.toFixed(2) ?? '?'} relayer=${setup.relayerMode}${setup.message ? ` (${setup.message})` : ''}`,
      );
    } catch (e) {
      console.warn('[Runner] Polymarket auto-setup failed (non-fatal):', e);
    }
  }

  alerts.runnerStarted();

  await runOnce();

  const scheduleNextCycle = async () => {
    if (!status.running) return;
    const cycleStart = Date.now();

    // Refresh the lease each cycle; if we lost it (another instance took over
    // after we went stale), stop so we never double-trade.
    try {
      const { tryAcquireRunnerLock } = await import('@/lib/monitoring/system-state');
      const stillOwn = await tryAcquireRunnerLock(
        RUNNER_INSTANCE_ID,
        RUNNER_LOCK_TTL_MS,
        process.env.SNIPER_ENABLE_REAL_EXECUTION !== 'true',
      );
      if (!stillOwn) {
        console.warn('[Runner] Lost the runner lock to another instance — stopping this loop.');
        stopRunner({ manual: false });
        return;
      }
    } catch {
      // transient — keep going; the next cycle will retry the refresh
    }

    if (
      cycleInFlight &&
      cycleInFlightSince > 0 &&
      Date.now() - cycleInFlightSince > MAX_CYCLE_IN_FLIGHT_MS
    ) {
      console.warn('[Runner] Prior cycle exceeded max in-flight time — forcing reset');
      cycleInFlight = false;
      cycleInFlightSince = 0;
    }
    if (cycleInFlight) {
      console.warn('[Runner] Skipping cycle — prior run still in flight');
    } else {
      cycleInFlight = true;
      cycleInFlightSince = Date.now();
      try {
        await runOnce();
      } catch (e) {
        console.error('[Runner] Error in loop:', e);
      } finally {
        cycleInFlight = false;
        cycleInFlightSince = 0;
      }
    }
    status.lastCycleDurationMs = Date.now() - cycleStart;
    persistStatus();
    if (!status.running) return;
    const baseInterval = await getRunnerIntervalMs();
    const rawDelay = Math.max(baseInterval, status.lastCycleDurationMs ?? baseInterval);
    const liveCap = process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true' ? 55_000 : rawDelay;
    const delay = process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true'
      ? Math.min(liveCap, rawDelay)
      : rawDelay;
    cycleTimeout = setTimeout(() => void scheduleNextCycle(), delay);
  };

  void scheduleNextCycle();

  persistStatus();
}

export function stopRunner(options?: { manual?: boolean }) {
  syncStatusFromStore();
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  if (cycleTimeout) {
    clearTimeout(cycleTimeout);
    cycleTimeout = null;
  }
  status.running = false;
  persistStatus();
  getRunnerBookHub().stop();
  void import('@/lib/monitoring/system-state')
    .then((m) => m.releaseRunnerLock(RUNNER_INSTANCE_ID))
    .catch(() => {});
  if (options?.manual !== false) {
    void import('@/lib/monitoring/runner-control')
      .then((m) => m.persistRunnerDesiredState('stopped', 'user', 'manual stop'))
      .catch(() => {});
  }
  console.log('[Runner] Stopped');
  alerts.runnerStopped();
}

async function runLiveSelfHealIfEnabled(): Promise<void> {
  if (process.env.SNIPER_ENABLE_REAL_EXECUTION !== 'true') return;
  try {
    const { runLiveSelfHeal } = await import('@/lib/execution/live-self-heal');
    const intervalMs = Number(process.env.SNIPER_SELF_HEAL_INTERVAL_MS) || undefined;
    await runLiveSelfHeal({ intervalMs });
  } catch (e) {
    console.warn('[Runner] Live self-heal error (non-fatal):', e);
  }
}

async function reconcileRealTradesIfEnabled(phase: 'pre' | 'post'): Promise<void> {
  if (process.env.SNIPER_ENABLE_REAL_EXECUTION !== 'true') return;
  try {
    const { reconcilePendingRealTrades } = await import('@/lib/execution/reconcile-real-trades');
    const recon = await reconcilePendingRealTrades();
    if (recon.checked > 0 || recon.updated > 0) {
      console.log(
        `[Runner] Real trade reconciliation (${phase}): checked=${recon.checked}, updated=${recon.updated}, errors=${recon.errors}`,
      );
    }
  } catch (reconErr) {
    console.warn(`[Runner] Reconciliation error (${phase}, non-fatal):`, reconErr);
  }
}

export async function runOnce() {
  if (!status.running) return;

  incrementRunCount();

  const activeStrategies = await db.query.strategies.findMany({
    where: (s, { eq }) => eq(s.isActive, true),
  });

  // Gate the metered residential proxy on real execution being active THIS cycle.
  // A paper soak (no active live strategy) must never route Polymarket egress
  // through the proxy — any CLOB access below (self-heal, reconciliation, reads)
  // then goes direct. Set before self-heal so even the first call is covered.
  try {
    const realEnabledNow = process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true';
    const liveStrategyActive =
      realEnabledNow && activeStrategies.some((s) => s.paperOnly === false);
    const { setPolymarketProxyEgressEnabled } = await import('@/lib/clients/polymarket-http-proxy');
    setPolymarketProxyEgressEnabled(liveStrategyActive);
  } catch {
    // Non-fatal: never let proxy gating block a cycle.
  }

  await runLiveSelfHealIfEnabled();
  await reconcileRealTradesIfEnabled('pre');

  if (activeStrategies.length === 0) {
    status.lastRun = new Date().toISOString();
    status.lastCycle = {
      at: status.lastRun,
      marketPoolSize: 0,
      eligibleQuickFlipMarkets: 0,
      marketsEvaluated: 0,
      signalsThisCycle: 0,
      fillsThisCycle: 0,
      skipReason: 'No active strategies',
      riskMode: riskModeManager.getCurrentMode().current,
      activeProfiles: [],
    };
    persistStatus();
    return;
  }

  const hasBtcSniperStrategy = activeStrategies.some((s) => {
    const cfg = resolveStrategyConfigForType(s.type, s.config as unknown as StrategyConfig);
    return isBtcSniperStrategy(cfg, s.type);
  });

  const hasQuickFlipStrategy = activeStrategies.some((s) => {
    const cfg = resolveStrategyConfigForType(s.type, s.config as unknown as StrategyConfig);
    return cfg.tradingGoal === 'quick-flip' || s.type === 'live-quick-flip' || cfg.liveMarketsOnly;
  });

  const realEnabledForPool = process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true';
  const hasLiveSpreadCapture =
    realEnabledForPool &&
    activeStrategies.some((s) => {
      if (s.paperOnly) return false;
      const cfg = resolveStrategyConfigForType(s.type, s.config as unknown as StrategyConfig);
      return cfg.tradingGoal === 'spread-capture' || s.type === 'spread-scalper';
    });

  clearParentSignalCache();
  if (hasBtcSniperStrategy) {
    void fetchBtcUsdtCloses(30, true);
  }

  const markets = hasBtcSniperStrategy
    ? await getMarketsForBtcSniper()
    : hasQuickFlipStrategy
      ? await getMarketsForQuickFlip()
      : hasLiveSpreadCapture
        ? await getMarketsForLiveNearTerm()
        : await getAllMarkets();

  // === Calculate global and per-market protection factors upfront ===
  const recentQuality = executionManager.getRecentExecutionQuality(30);
  const badSlippage = recentQuality.filter(q => q.slippage > 0.006).length;
  const adverseRate = recentQuality.length > 0 ? badSlippage / recentQuality.length : 0;

  const systemHealth = executionManager.getSystemHealthScore();
  const unhealthyMarkets = executionManager.getUnhealthyMarkets(0.45);

  // Clean up any expired temporary adjustments from previous Grok recommendations
  const expiredAdjustments = cleanupExpiredAdjustments();
  if (expiredAdjustments.length > 0) {
    console.log(`[Runner] Reverted ${expiredAdjustments.length} expired temporary adjustment(s)`);
  }

  let globalRiskMultiplier = getEffectiveGlobalRiskMultiplier(1.0);

  const realEnabled = process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true';
  const liveRealActive =
    realEnabled && activeStrategies.some((s) => !s.paperOnly);

  let cycleLiveBalanceUsd: number | null = null;
  let skipLiveEntryScan = false;
  let earlyCycleBankrollUsd = 25;

  if (liveRealActive) {
    const { getPolymarketPrivateKey } = await import('@/lib/clients/polymarket-trading');
    const { resolveLiveUsdcBalance } = await import('@/lib/clients/polymarket-trading-setup');
    const pk = getPolymarketPrivateKey();
    if (pk) {
      cycleLiveBalanceUsd = await resolveLiveUsdcBalance(pk);
    }
    const { resolveLiveBankrollUsd } = await import('@/lib/research/live-bankroll');
    earlyCycleBankrollUsd = await resolveLiveBankrollUsd(cycleLiveBalanceUsd);
    if (cycleLiveBalanceUsd != null && cycleLiveBalanceUsd > 0) {
      const { minRealOrderUsd } = await import('@/lib/risk/sizing');
      const minUsd = minRealOrderUsd(Math.max(cycleLiveBalanceUsd, 0.01));
      skipLiveEntryScan = cycleLiveBalanceUsd < minUsd;
      if (skipLiveEntryScan) {
        console.log(
          `[Runner] Live bankroll $${cycleLiveBalanceUsd.toFixed(2)} < $${minUsd.toFixed(2)} min — exit-only cycle (skipping entry scan)`,
        );
      }
    }

    const { evaluateLiveMicroGuards } = await import('@/lib/monitoring/live-micro-guards');
    const microGuards = await evaluateLiveMicroGuards(cycleLiveBalanceUsd, earlyCycleBankrollUsd);
    if (!microGuards.entriesAllowed) {
      skipLiveEntryScan = true;
      console.warn(`[Runner] Micro guard (${microGuards.code}): ${microGuards.reason}`);
      await logAudit('live_micro_guard', {
        code: microGuards.code,
        reason: microGuards.reason,
        cashBalanceUsd: cycleLiveBalanceUsd,
        bankrollUsd: earlyCycleBankrollUsd,
      });
    }
  }

  // === Risk Mode Evaluation ===
  const decayingCount = activeStrategies.filter(
    (s) => edgeDecayMonitor.isDecaying(s.id, earlyCycleBankrollUsd).decaying,
  ).length;
  const riskModeResult = riskModeManager.evaluate(
    systemHealth,
    adverseRate,
    decayingCount,
    unhealthyMarkets.length
  );

  if (riskModeResult.changed) {
    const emoji = riskModeResult.newMode === 'EMERGENCY' ? '🚨' : riskModeResult.newMode === 'DEFENSIVE' ? '⚠️' : '✅';
    console.warn(`${emoji} [Runner] RISK MODE TRANSITION → ${riskModeResult.newMode} (was ${riskModeManager.getCurrentMode().previousMode})`);
    console.warn(`   Reason: ${riskModeResult.reason}`);
    console.warn(`   Effect: Strategy selection and market limits are now being restricted according to the new mode.`);
    await logAudit('risk_mode_change', {
      newMode: riskModeResult.newMode,
      previousMode: riskModeManager.getCurrentMode().previousMode,
      reason: riskModeResult.reason,
    });
  }

  globalRiskMultiplier =
    riskModeManager.getRiskMultiplier() * getEffectiveGlobalRiskMultiplier(1.0);

  const currentRiskMode = riskModeManager.getCurrentMode();
  let marketEvaluationLimit = 25;
  let allowedStrategies = activeStrategies;
  const liveMicroAccount = liveRealActive && earlyCycleBankrollUsd < 25;
  const quickFlipLimit = resolveQuickFlipMarketLimit(currentRiskMode.current, liveMicroAccount);

  if (currentRiskMode.current === 'DEFENSIVE') {
    marketEvaluationLimit = 12;
    allowedStrategies = activeStrategies.filter((s) => !['threshold'].includes(s.type));
    if (allowedStrategies.length === 0) allowedStrategies = activeStrategies;
    console.warn(`⚠️ [Runner] DEFENSIVE MODE — evaluating only ${allowedStrategies.length} strategy(ies) across ${marketEvaluationLimit} markets with extra conservatism`);
  }

  if (currentRiskMode.current === 'EMERGENCY') {
    marketEvaluationLimit = 2;
    const SURVIVAL_STRATEGY_TYPES = ['orderbook-imbalance', 'resolution-proximity'];
    allowedStrategies = activeStrategies.filter((s) => SURVIVAL_STRATEGY_TYPES.includes(s.type));
    if (allowedStrategies.length === 0) {
      allowedStrategies = activeStrategies.slice(0, 1);
    }
    if (systemHealth < 0.38) {
      marketEvaluationLimit = 1;
      allowedStrategies = allowedStrategies.slice(0, 1);
    }
    const pausedStrategies = activeStrategies.filter((s) => !allowedStrategies.some((a) => a.id === s.id));
    console.warn(`🚨 [Runner] EMERGENCY MODE — survival posture only.`);
    if (pausedStrategies.length > 0) {
      console.warn(`   PAUSED STRATEGIES due to Emergency: ${pausedStrategies.map((s) => s.name).join(', ')}`);
    }
    console.warn(`   Evaluating only ${allowedStrategies.length} strategy(ies) across ${marketEvaluationLimit} market(s).`);
  }

  const bookCache = new CycleBookCache();
  const evalMarketsToFetch: Array<{ platform: string; externalId: string }> = [];
  const marketsToFetch: Array<{ platform: string; externalId: string }> = [];
  const marketByKey = new Map(markets.map((m) => [`${m.platform}:${m.externalId}`, m]));

  for (const stratRow of allowedStrategies) {
    const config = resolveStrategyConfigForType(stratRow.type, stratRow.config as unknown as StrategyConfig);
    const isQuickFlipStrat =
      config.tradingGoal === 'quick-flip' || config.liveMarketsOnly || stratRow.type === 'live-quick-flip';
    const isBtcSniperStrat = isBtcSniperStrategy(config, stratRow.type);
    const isSpreadCaptureStrat = isSpreadCaptureStrategy(config, stratRow.type);
    const stratLimit = isQuickFlipStrat
      ? quickFlipLimit
      : isBtcSniperStrat
        ? BTC_SNIPER_EVAL_LIMIT
        : isSpreadCaptureStrat
        ? SPREAD_CAPTURE_EVAL_LIMIT
        : marketEvaluationLimit;
    const isLiveStrat = realEnabled && stratRow.paperOnly === false;

    if (isLiveStrat && skipLiveEntryScan) {
      continue;
    }

    let openPool = markets.filter((m) => m.status === 'open');
    if (isQuickFlipStrat) {
      openPool = filterQuickFlipMarkets(openPool);
      openPool = openPool.length > 0 ? rankQuickFlipMarkets(openPool) : [];
    } else if (isBtcSniperStrat) {
      openPool = rankBtcSniperMarkets(filterBtcSniperMarkets(openPool));
    } else if (isSpreadCaptureStrat && isLiveStrat) {
      openPool = filterLiveResolutionMarkets(openPool);
    }
    for (const m of openPool.slice(0, stratLimit)) {
      evalMarketsToFetch.push({ platform: m.platform, externalId: m.externalId });
      marketsToFetch.push({ platform: m.platform, externalId: m.externalId });
      if (m.siblingTokenId) {
        evalMarketsToFetch.push({ platform: m.platform, externalId: m.siblingTokenId });
        marketsToFetch.push({ platform: m.platform, externalId: m.siblingTokenId });
      }
    }
  }

  // Live strategies (paperOnly === false) must track their REAL inventory, not
  // paper fills, so exits (take-profit / stop / max-hold) fire on real holdings.
  const realStrategyIds = realEnabled
    ? allowedStrategies.filter((s) => s.paperOnly === false).map((s) => s.id)
    : [];
  const paperStrategyIds = allowedStrategies
    .filter((s) => !realStrategyIds.includes(s.id))
    .map((s) => s.id);

  const openPositionsByStrategy = await getOpenPositionsByStrategy(paperStrategyIds);
  if (realStrategyIds.length > 0) {
    try {
      const realPositions = await getRealOpenPositionsByStrategy(realStrategyIds);
      for (const [strategyId, positions] of realPositions) {
        openPositionsByStrategy.set(strategyId, positions);
      }
    } catch (e) {
      console.warn('[Runner] Failed to load real open positions (non-fatal):', e);
      for (const id of realStrategyIds) {
        if (!openPositionsByStrategy.has(id)) openPositionsByStrategy.set(id, []);
      }
    }
  }

  const evalKeys = new Set(
    evalMarketsToFetch.map((m) => `${m.platform}:${m.externalId}`),
  );
  const openPosFlat: Array<{ platform: string; externalId: string; openedAt: Date }> = [];
  for (const positions of openPositionsByStrategy.values()) {
    for (const pos of positions) {
      openPosFlat.push({
        platform: pos.platform,
        externalId: pos.marketExternalId,
        openedAt: pos.openedAt,
      });
    }
  }
  openPosFlat.sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
  const MAX_OPEN_BOOK_MARKETS = 60;
  for (const pos of openPosFlat.slice(0, MAX_OPEN_BOOK_MARKETS)) {
    const key = `${pos.platform}:${pos.externalId}`;
    if (!evalKeys.has(key)) {
      marketsToFetch.push({ platform: pos.platform, externalId: pos.externalId });
    }
  }

  const syncKeys = new Set<string>();
  const marketsToSync: typeof markets = [];
  for (const m of evalMarketsToFetch) {
    const key = `${m.platform}:${m.externalId}`;
    if (syncKeys.has(key)) continue;
    syncKeys.add(key);
    const found = marketByKey.get(key);
    if (found) marketsToSync.push(found);
  }

  let marketDbIds = new Map<string, string>();
  try {
    const { syncMarketsToDb } = await import('@/lib/markets');
    marketDbIds = await syncMarketsToDb(marketsToSync);
  } catch (syncErr) {
    console.warn('[Runner] Non-fatal: failed to sync evaluated markets to DB', syncErr);
  }

  await bookCache.fetchBooks(marketsToFetch);
  setBtcSniperBookCache(bookCache);

  const snapshotBatch = await getRecentSnapshotsBatch(
    evalMarketsToFetch.map((m) => ({ platform: m.platform, marketExternalId: m.externalId })),
    8,
  );

  const { getPaperBudgetSettings } = await import('@/lib/settings/paper-budget');
  const cyclePaperBudget = await getPaperBudgetSettings();

  if (liveRealActive) {
    const { loadRealRiskSnapshot } = await import('@/lib/risk/real-bankroll');
    if (cycleLiveBalanceUsd != null && cycleLiveBalanceUsd > 0) {
      portfolioRiskManager.applyMicroRealBudget(cycleLiveBalanceUsd);
      const realRisk = await loadRealRiskSnapshot(cycleLiveBalanceUsd, realStrategyIds);
      portfolioRiskManager.setCyclePortfolioState(realRisk.state, realRisk.equityUsd);
    } else {
      const snap = (await import('@/lib/clients/polymarket-trading-setup')).getPolymarketSetupSnapshot();
      const fallbackBal = snap?.balanceUsd && snap.balanceUsd > 0 ? snap.balanceUsd : 25;
      console.warn(
        `[Runner] Live mode: CLOB balance read failed — sizing with cached $${fallbackBal.toFixed(2)} (real exposure, not paper caps)`,
      );
      portfolioRiskManager.applyMicroRealBudget(fallbackBal);
      const realRisk = await loadRealRiskSnapshot(fallbackBal, realStrategyIds);
      portfolioRiskManager.setCyclePortfolioState(realRisk.state, realRisk.equityUsd);
    }
  } else {
    const paperRisk = await loadPaperRiskState(bookCache.toMarkPriceMap());
    const { applyPaperBudgetToPortfolioManager } = await import('@/lib/risk/portfolio-manager');
    applyPaperBudgetToPortfolioManager(cyclePaperBudget);
    portfolioRiskManager.setCyclePortfolioState(
      paperRisk.state,
      paperRisk.equityUsd,
      paperRisk.ledger.realizedPnLUsd,
    );
  }

  const { resolveLiveBankrollUsd } = await import('@/lib/research/live-bankroll');
  const cycleBankrollUsd = liveRealActive
    ? await resolveLiveBankrollUsd(cycleLiveBalanceUsd)
    : 25;

  if (liveRealActive) {
    const { primeRunnerLiveFilterSnapshot } = await import('@/lib/monitoring/live-filter-cache');
    await primeRunnerLiveFilterSnapshot(cycleBankrollUsd);
    const { loadLiveIntelligenceState } = await import('@/lib/monitoring/live-intelligence');
    const intelState = await loadLiveIntelligenceState();
    const runLearning =
      getCurrentRunCount() % 5 === 0 || !intelState.lastLearningAt;
    if (runLearning) {
      const { runLiveLearningCycle } = await import('@/lib/monitoring/live-learning');
      const learn = await runLiveLearningCycle(cycleBankrollUsd);
      if (learn.patched) {
        console.warn(`[Runner] Live learning applied: ${learn.reasons.join('; ')}`);
      }
      await primeRunnerLiveFilterSnapshot(cycleBankrollUsd);
    }
  }

  const allAllocations = await getDynamicAllocations(
    activeStrategies.map((s) => s.id),
    cycleBankrollUsd,
  );

  const activeProfiles: ActiveStrategyProfile[] = activeStrategies.map((s) => {
    const cfg = resolveStrategyConfigForType(s.type, s.config as unknown as StrategyConfig);
    return {
      id: s.id,
      name: s.name,
      type: s.type,
      tradingStyle: cfg.tradingStyle,
      tradingGoal: cfg.tradingGoal,
      maxSizeUsd: s.paperOnly !== false ? cyclePaperBudget.maxExposureUsd : cfg.maxSizeUsd,
      cooldownSeconds: cfg.cooldownSeconds,
      aggressiveEntryFills: cfg.aggressiveEntryFills,
    };
  });

  const eligibleQuickFlipMarkets = filterQuickFlipMarkets(markets).length;
  let marketsEvaluatedThisCycle = 0;
  let skipReason: string | null = null;

  if (hasQuickFlipStrategy && eligibleQuickFlipMarkets === 0) {
    skipReason = `No markets resolving within ${QUICK_FLIP_MAX_RESOLUTION_HOURS}h (pool: ${markets.length} fetched)`;
  }
  if (skipLiveEntryScan && cycleLiveBalanceUsd != null) {
    skipReason = `Live bankroll $${cycleLiveBalanceUsd.toFixed(2)} — exit-only cycle (no cash for entries)`;
  }

  let signalsThisRun = 0;
  let fillsThisRun = 0;

  for (const stratRow of allowedStrategies) {
    const config = resolveStrategyConfigForType(stratRow.type, stratRow.config as unknown as StrategyConfig);
    const strategyImpl = getStrategy(resolveStrategyImplType(stratRow.type, config));
    if (!strategyImpl) continue;
    const openPositions = openPositionsByStrategy.get(stratRow.id) ?? [];
    const openByMarket = new Map(
      openPositions.map((p) => [`${p.platform}:${p.marketExternalId}`, p]),
    );

    let allocation = allAllocations[stratRow.id] || { weight: 0.7, maxSizeMultiplier: 0.8, reason: 'Default' };

    if (currentRiskMode.current === 'DEFENSIVE') {
      allocation = {
        ...allocation,
        maxSizeMultiplier: allocation.maxSizeMultiplier * 0.75,
        reason: allocation.reason + ' + Defensive mode conservatism',
      };
    }
    if (currentRiskMode.current === 'EMERGENCY') {
      allocation = {
        ...allocation,
        maxSizeMultiplier: allocation.maxSizeMultiplier * 0.4,
        reason: allocation.reason + ' + Emergency mode conservatism',
      };
    }

    // Reduce market sample based on risk mode; quick-flip strategies prefer live fast markets
    let openPool = markets.filter((m) => m.status === 'open');
    let stratMarketLimit = marketEvaluationLimit;

    if (config.tradingGoal === 'quick-flip' || config.liveMarketsOnly || stratRow.type === 'live-quick-flip') {
      stratMarketLimit = quickFlipLimit;
      const candidates = filterQuickFlipMarkets(openPool);
      openPool = candidates.length > 0 ? rankQuickFlipMarkets(candidates) : [];
      if (openPool.length === 0) {
        console.warn(`[Runner] Quick-flip "${stratRow.name}": no markets resolving within ${QUICK_FLIP_MAX_RESOLUTION_HOURS}h this cycle`);
      }
    } else if (isBtcSniperStrategy(config, stratRow.type)) {
      stratMarketLimit = BTC_SNIPER_EVAL_LIMIT;
      openPool = rankBtcSniperMarkets(filterBtcSniperMarkets(openPool));
      if (openPool.length === 0 && !skipReason) {
        skipReason = `BTC sniper "${stratRow.name}": 0 active 5m/15m windows this cycle`;
      }
    } else if (isSpreadCaptureStrategy(config, stratRow.type)) {
      stratMarketLimit = SPREAD_CAPTURE_EVAL_LIMIT;
      if (realEnabled && stratRow.paperOnly === false) {
        openPool = filterLiveResolutionMarkets(openPool);
        if (openPool.length === 0 && !skipReason) {
          skipReason = `No markets resolving within ${LIVE_MAX_RESOLUTION_HOURS}h (pool: ${markets.length} fetched)`;
        }
      }
    }

    const relevantMarkets =
      realEnabled && stratRow.paperOnly === false && skipLiveEntryScan
        ? []
        : isSpreadCaptureStrategy(config, stratRow.type)
          ? rankMarketsBySpreadWidth(
              openPool.slice(0, SPREAD_CAPTURE_EVAL_LIMIT),
              bookCache,
            ).slice(0, stratMarketLimit)
          : openPool.slice(0, stratMarketLimit);
    marketsEvaluatedThisCycle = Math.max(marketsEvaluatedThisCycle, relevantMarkets.length);

    if (
      (config.tradingGoal === 'quick-flip' || stratRow.type === 'live-quick-flip') &&
      relevantMarkets.length === 0 &&
      !skipReason
    ) {
      skipReason = `Quick-flip "${stratRow.name}": 0 eligible markets within ${QUICK_FLIP_MAX_RESOLUTION_HOURS}h`;
    }

    // Always evaluate markets where this strategy has open positions (for exits)
    const marketKeys = new Set(relevantMarkets.map((m) => `${m.platform}:${m.externalId}`));
    const missingPositions = openPositions.filter(
      (pos) => !marketKeys.has(`${pos.platform}:${pos.marketExternalId}`),
    );
    if (missingPositions.length > 0) {
      // Fresh Polymarket metadata for held tokens (endDate drives exits) —
      // fetched in parallel; fall back to the pool row, then to a stub.
      const fetchedByKey = new Map<string, Market>();
      const polyMissing = missingPositions.filter((p) => p.platform === 'polymarket');
      if (polyMissing.length > 0) {
        try {
          const { fetchPolymarketMarketByTokenId } = await import('@/lib/clients/polymarket');
          await runPool(polyMissing, 6, async (pos) => {
            try {
              const fetched = await fetchPolymarketMarketByTokenId(pos.marketExternalId);
              if (fetched) {
                fetchedByKey.set(`${pos.platform}:${pos.marketExternalId}`, fetched);
              }
            } catch {
              // keep pool row if any
            }
          });
        } catch {
          // module load failure — pool rows/stubs still cover exits
        }
      }
      for (const pos of missingPositions) {
        const key = `${pos.platform}:${pos.marketExternalId}`;
        if (marketKeys.has(key)) continue;
        const found =
          fetchedByKey.get(key) ??
          marketByKey.get(key) ??
          ({
            platform: pos.platform,
            externalId: pos.marketExternalId,
            question: '',
            status: 'open',
            volume: 0,
            updatedAt: new Date().toISOString(),
          } as Market);
        relevantMarkets.push(found);
        marketKeys.add(key);
        if (!evalKeys.has(key)) {
          evalKeys.add(key);
          marketsToFetch.push({ platform: pos.platform, externalId: pos.marketExternalId });
        }
      }
    }

    const evalCtx: EvaluateMarketContext = {
      stratRow,
      strategyImpl,
      config,
      allocation,
      openByMarket,
      bookCache,
      snapshotBatch,
      marketDbIds,
      lastSignalAtByKey,
      globalRiskMultiplier,
      paperBudget: cyclePaperBudget,
      liveBalanceUsd: cycleLiveBalanceUsd,
      skipEntryScan: realEnabled && stratRow.paperOnly === false && skipLiveEntryScan,
    };

    const evalResults = await runPool(
      relevantMarkets,
      MARKET_EVAL_CONCURRENCY,
      async (market) => {
        try {
          return await evaluateMarketForStrategy(market, evalCtx);
        } catch (e) {
          console.warn(`[Runner] Error on ${market.externalId}:`, e);
          void logAudit('runner_market_error', {
            market: market.externalId,
            strategy: stratRow.name,
            error: e instanceof Error ? e.message : String(e),
            stack: e instanceof Error ? e.stack?.slice(0, 500) : undefined,
          });
          return null;
        }
      },
    );

    const queuedSignals = evalResults.filter((q): q is QueuedRunnerSignal => q != null);

    if (queuedSignals.length > 0) {
      signalsThisRun += queuedSignals.length;
      const inserted = await db
        .insert(signals)
        .values(
          queuedSignals.map((q) => ({
            strategyId: q.stratRow.id,
            marketId: q.marketDbId,
            action: q.signal.action as 'BUY' | 'SELL' | 'CANCEL',
            price: q.signal.price.toString(),
            size: q.finalSize.toString(),
            reason: `${q.signal.reason} | Risk-adjusted from ${q.signal.size} → ${q.finalSize.toFixed(0)}${q.sizeReason}`,
          })),
        )
        .returning({ id: signals.id });

      // Cash-aware guard: read real spendable balance once per cycle so we stop
      // submitting BUYs the CLOB would reject for insufficient funds. Without
      // this the runner fires hundreds of rejected orders once the bankroll is
      // spent. Fails open (Infinity) so a transient balance-read error never
      // silently halts live trading.
      let realCashRemaining = Number.POSITIVE_INFINITY;
      const realSignalQueued =
        process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true' &&
        queuedSignals.some((q) => !q.stratRow.paperOnly);
      const realBuyQueued =
        realSignalQueued && queuedSignals.some((q) => q.signal.action === 'BUY');
      if (realBuyQueued) {
        if (cycleLiveBalanceUsd != null && cycleLiveBalanceUsd > 0) {
          realCashRemaining = cycleLiveBalanceUsd;
        } else {
          try {
            const { getPolymarketPrivateKey } = await import('@/lib/clients/polymarket-trading');
            const { resolveLiveUsdcBalance } = await import(
              '@/lib/clients/polymarket-trading-setup'
            );
            const pk = getPolymarketPrivateKey();
            const resolved = pk ? await resolveLiveUsdcBalance(pk) : null;
            realCashRemaining =
              resolved != null && resolved > 0 ? resolved : Number.POSITIVE_INFINITY;
          } catch {
            realCashRemaining = Number.POSITIVE_INFINITY;
          }
        }
      }

      // In-flight guard: never submit a second real order on a market that
      // already has a pending order. Prevents duplicate BUYs (retry spam) and
      // double SELLs while reconciliation is still confirming the prior order.
      const pendingBuyMarkets = new Set<string>();
      const pendingSellMarkets = new Set<string>();
      /** Micro live account: one open position — exit before stacking new entries. */
      let liveBuysThisCycle = 0;
      const LIVE_MICRO_MAX_OPEN_POSITIONS = 1;
      if (realSignalQueued) {
        try {
          const pendingRows = await db.query.realTrades.findMany({
            where: (t, { eq }) => eq(t.status, 'pending'),
            columns: { platform: true, marketExternalId: true, side: true },
            limit: 500,
          });
          for (const row of pendingRows) {
            const key = `${row.platform}:${row.marketExternalId}`;
            if (row.side === 'SELL') pendingSellMarkets.add(key);
            else pendingBuyMarkets.add(key);
          }
        } catch {
          // Fail open — a read error must not block exits.
        }
      }

      for (let i = 0; i < queuedSignals.length; i++) {
        const q = queuedSignals[i];
        const signalId = inserted[i]?.id;
        void logAudit('runner_signal_created', {
          strategy: q.stratRow.name,
          market: q.market.externalId,
          marketDbId: q.marketDbId,
          signalId,
          action: q.signal.action,
          size: q.finalSize,
        });

        const isRealAllowed =
          process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true' && !q.stratRow.paperOnly;

        if (isRealAllowed) {
          const marketKey = `${q.market.platform}:${q.market.externalId}`;

          // Skip duplicate orders of the same side while one is still pending.
          if (q.signal.action === 'BUY' && pendingBuyMarkets.has(marketKey)) {
            void logAudit('runner_real_skipped_in_flight', {
              strategy: q.stratRow.name,
              market: q.market.externalId,
              action: q.signal.action,
            });
            continue;
          }
          if (q.signal.action === 'BUY') {
            // Re-read open positions at order time — cycle-start snapshot can be stale
            // after reconcile/self-heal/partial exits in the same loop.
            let openForStrat = openPositionsByStrategy.get(q.stratRow.id) ?? [];
            if (realEnabled && !q.stratRow.paperOnly) {
              try {
                const { getRealOpenPositionsByStrategy } = await import(
                  '@/lib/execution/real-positions'
                );
                const fresh = await getRealOpenPositionsByStrategy([q.stratRow.id]);
                openForStrat = fresh.get(q.stratRow.id) ?? [];
              } catch {
                // use cycle-start snapshot
              }
            }
            const { isMeaningfulOpenPosition } = await import('@/lib/execution/dead-market-tokens');
            const meaningfulOpen = openForStrat.filter((p) =>
              isMeaningfulOpenPosition(p.netSize, p.avgEntryPrice),
            );
            if (meaningfulOpen.length >= LIVE_MICRO_MAX_OPEN_POSITIONS) {
              void logAudit('runner_real_skipped_position_cap', {
                strategy: q.stratRow.name,
                openCount: meaningfulOpen.length,
                rawOpenCount: openForStrat.length,
                market: q.market.externalId,
              });
              continue;
            }
            if (liveBuysThisCycle >= 1) {
              void logAudit('runner_real_skipped_one_buy_per_cycle', {
                strategy: q.stratRow.name,
                market: q.market.externalId,
              });
              continue;
            }
          }
          if (q.signal.action === 'SELL' && pendingSellMarkets.has(marketKey)) {
            void logAudit('runner_real_skipped_in_flight', {
              strategy: q.stratRow.name,
              market: q.market.externalId,
              action: q.signal.action,
            });
            continue;
          }

          // Skip BUYs we can't fund — keeps the CLOB from rejecting a flood of
          // over-budget orders. Exits (SELL) always proceed; they free cash.
          let orderSize = q.finalSize;
          let orderMaxNotional = q.config.maxSizeUsd ?? 1;
          if (q.signal.action === 'BUY') {
            const { POLYMARKET_MIN_MARKET_BUY_USD } = await import('@/lib/risk/sizing');
            const dynamicStake = Number.isFinite(realCashRemaining)
              ? Math.min(orderMaxNotional, realCashRemaining * 0.92)
              : orderMaxNotional;
            if (realCashRemaining < POLYMARKET_MIN_MARKET_BUY_USD) {
              void logAudit('runner_real_skipped_low_stake', {
                strategy: q.stratRow.name,
                market: q.market.externalId,
                dynamicStake: dynamicStake,
                realCashRemaining,
                reason: 'below_polymarket_min_buy',
              });
              continue;
            }
            orderMaxNotional = Math.max(
              POLYMARKET_MIN_MARKET_BUY_USD,
              Math.min(dynamicStake, orderMaxNotional),
            );
            const cappedShares = Math.max(1, Math.floor(orderMaxNotional / q.signal.price));
            if (cappedShares < orderSize) {
              orderSize = cappedShares;
            }
            // Ensure FOK market BUY meets Polymarket $1 floor after share rounding.
            if (q.signal.price * orderSize < POLYMARKET_MIN_MARKET_BUY_USD) {
              orderSize = Math.ceil(POLYMARKET_MIN_MARKET_BUY_USD / q.signal.price);
            }
          }

          const estimatedUsd = q.signal.price * orderSize;
          if (q.signal.action === 'BUY' && estimatedUsd > realCashRemaining + 1e-9) {
            void logAudit('runner_real_skipped_no_cash', {
              strategy: q.stratRow.name,
              market: q.market.externalId,
              estimatedUsd,
              realCashRemaining,
            });
            continue;
          }

          if (q.signal.action === 'BUY') {
            const ask = q.book?.asks?.[0]?.price ?? q.signal.price;
            const bid = q.book?.bids?.[0]?.price ?? q.signal.price * 0.98;
            const targetMultiple =
              q.config.targetProfitMultiple > 0
                ? q.config.targetProfitMultiple
                : 1.2;
            const { checkLiveEntryGates } = await import('@/lib/execution/live-entry-gates');
            const gate = await checkLiveEntryGates({
              market: q.market,
              book: q.book,
              config: q.config,
              ask,
              bid,
              stakeUsd: estimatedUsd,
              targetMultiple,
              strategyType: q.stratRow.type,
            });
            if (!gate.allowed) {
              void logAudit('runner_real_skipped_entry_gate', {
                strategy: q.stratRow.name,
                market: q.market.externalId,
                code: gate.code,
                reason: gate.reason,
              });
              continue;
            }
          }

          const { placeRealOrder } = await import('@/lib/execution/real-executor');
          const result = await placeRealOrder({
            market: q.market,
            side: q.signal.action as 'BUY' | 'SELL',
            price: q.signal.price,
            size: orderSize,
            edge: q.signal.edge,
            confidence: q.signal.confidence,
            isExit: q.isExitSignal,
            book: q.book ?? undefined,
            takeLiquidity:
              q.signal.action === 'BUY' &&
              (q.isQuickFlip ||
                q.config.tradingGoal === 'spread-capture' ||
                q.stratRow.type === 'btc-sniper' ||
                q.config.tradingGoal === 'btc-momentum'),
            maxNotionalUsd: orderMaxNotional,
            reason: `[REAL][${q.stratRow.name}] ${q.signal.reason} (risk-adjusted)`,
            signalId,
          });

          if (result.success) {
            fillsThisRun++;
            if (q.signal.action === 'BUY') {
              realCashRemaining -= estimatedUsd;
              liveBuysThisCycle++;
            }
            pendingBuyMarkets.add(marketKey);
            lastSignalAtByKey.set(q.cooldownKey, Date.now());
            console.log(
              `[Runner] REAL order posted ${q.market.externalId.slice(0, 12)}… ${q.signal.action} trade=${result.tradeId}`,
            );
            alerts.realOrder({
              platform: q.market.platform,
              side: q.signal.action,
              size: q.signal.size,
              price: q.signal.price,
              reason: q.signal.reason,
            });
          } else {
            // Cooldown failed entries so the runner doesn't re-fire the same
            // rejected BUY every ~4s. Exits are exempt — they must keep retrying
            // until the position is actually closed.
            if (!q.isExitSignal) {
              lastSignalAtByKey.set(q.cooldownKey, Date.now());
            }
            console.warn(
              `[Runner] REAL order blocked ${q.market.externalId.slice(0, 12)}…: ${result.error ?? 'unknown'}`,
            );
          }
        } else {
          const useImmediate = shouldUseImmediateFill(
            q.config,
            q.signal.action as 'BUY' | 'SELL',
            q.isExitSignal,
          );
          const topBid = q.book?.bids?.[0]?.size || 0;
          const topAsk = q.book?.asks?.[0]?.size || 0;
          const bookImbalance =
            topBid + topAsk > 0 ? (topBid - topAsk) / (topBid + topAsk) : 0;

          const fill = paperSimulator.snipe({
            market: q.market,
            side: q.signal.action as 'BUY' | 'SELL',
            price: q.signal.price,
            size: q.finalSize,
            reason: `[${q.stratRow.name}] ${q.signal.reason} (risk-adjusted)`,
            book: q.book ?? undefined,
            immediate: useImmediate,
            isExit: q.isExitSignal,
            minFillProbability: q.config.minFillProbability,
            bookImbalance,
            regime: q.advancedRegime,
          });

          if (fill) {
            fillsThisRun++;
            lastSignalAtByKey.set(q.cooldownKey, Date.now());

            await persistPaperFill({
              platform: fill.platform,
              marketExternalId: fill.marketExternalId,
              signalId,
              side: fill.side,
              price: fill.price,
              size: fill.size,
              fee: fill.fee,
            });

            alerts.paperFill(fill);
          }
        }
      }
    }
  }

  // Cap the cooldown map so a multi-week soak can't grow it unbounded — any
  // entry older than a day is far past every strategy's cooldown window.
  if (lastSignalAtByKey.size > 2000) {
    const cooldownCutoff = Date.now() - 24 * 3600 * 1000;
    for (const [key, at] of lastSignalAtByKey) {
      if (at < cooldownCutoff) lastSignalAtByKey.delete(key);
    }
  }

  status.lastRun = new Date().toISOString();
  if (signalsThisRun === 0 && marketsEvaluatedThisCycle > 0 && !skipReason) {
    skipReason = `No entries matched price/spread/depth filters (${marketsEvaluatedThisCycle} markets checked)`;
  }
  await syncRunnerSessionCountersFromDb();
  status.lastCycle = {
    at: status.lastRun,
    marketPoolSize: markets.length,
    eligibleQuickFlipMarkets,
    marketsEvaluated: marketsEvaluatedThisCycle,
    signalsThisCycle: signalsThisRun,
    fillsThisCycle: fillsThisRun,
    skipReason: signalsThisRun === 0 ? skipReason : null,
    riskMode: riskModeManager.getCurrentMode().current,
    activeProfiles,
    bookFetch: bookCache.lastHubStats
      ? {
          ...bookCache.lastHubStats,
          polyConnected: getRunnerBookHub().getLastStats().polyConnected,
          kalshiConnected: getRunnerBookHub().getLastStats().kalshiConnected,
        }
      : undefined,
  };
  persistStatus();

  const cyclePortfolioSnapshot = portfolioRiskManager.peekCyclePortfolioState();

  portfolioRiskManager.clearCycleCache();

  if (liveRealActive) {
    const { flushLiveGateStats } = await import('@/lib/monitoring/live-gate-stats');
    const { clearRunnerLiveFilterSnapshot } = await import('@/lib/monitoring/live-filter-cache');
    await flushLiveGateStats();
    clearRunnerLiveFilterSnapshot();
  }

  if (signalsThisRun > 0) {
    console.log(`[Runner] Run complete. Signals: ${signalsThisRun}, Fills: ${fillsThisRun}`);
  }

  // === Edge Decay Monitoring — feed rolling PnL windows (every 5 cycles) ===
  if (getCurrentRunCount() % 5 === 0) {
    try {
      const decayWindowHours = cycleBankrollUsd < 25 ? 2 : 6;
      const pnlStats = await computeStrategyPnlWindows(
        activeStrategies.map((s) => s.id),
        decayWindowHours,
      );
      for (const [, stats] of pnlStats) {
        if (stats.fills >= 3) {
          edgeDecayMonitor.recordWindow(
            stats.strategyId,
            statsToPerformanceWindow(stats, decayWindowHours),
          );
        }
      }
    } catch (e) {
      console.warn('[Runner] Edge decay window update failed (non-fatal):', e);
    }
  }

  for (const strat of activeStrategies) {
    const decay = edgeDecayMonitor.isDecaying(strat.id, cycleBankrollUsd);
    if (decay.decaying) {
      console.warn(`[Runner] EDGE DECAY on ${strat.name}: ${decay.reason}`);
      await logAudit('edge_decay_detected', {
        strategy: strat.name,
        severity: decay.severity,
        reason: decay.reason,
      });
    }
  }

  // Periodic portfolio health log (every ~10 runs on average)
  if (Math.random() < 0.1) {
    const state =
      cyclePortfolioSnapshot ?? (await portfolioRiskManager.getCurrentPortfolioState());
    console.log(`[Runner] Portfolio health: Exposure $${state.totalExposureUsd.toFixed(0)} | Open positions: ${state.openPositions}`);

    // Persist rich risk snapshot (durability + risk exposure) for 24/7 resilience
    try {
      const { persistExecutionHealth, persistRiskSnapshot } = await import('@/lib/monitoring/system-state');
      const unhealthy = executionManager.getUnhealthyMarkets(0.5);
      const avgSlip = executionManager.getAverageSlippage(30);
      const healthScore = executionManager.getSystemHealthScore();
      const currentRisk = riskModeManager.getCurrentMode();

      await persistExecutionHealth({
        systemHealthScore: healthScore,
        unhealthyMarketCount: unhealthy.length,
        recentAdverseRate: avgSlip > 0 ? Math.min(1, avgSlip * 10) : 0,
        lastUpdated: new Date().toISOString(),
      }, 'periodic runner snapshot');

      await persistRiskSnapshot({
        totalExposureUsd: state.totalExposureUsd,
        openPositions: state.openPositions,
        currentRiskMode: currentRisk.current,
        systemHealthScore: healthScore,
        adverseRate: avgSlip,
        currentBankroll: (portfolioRiskManager as any).currentBankroll ?? 0,
        maxDrawdown: state.maxDrawdown,
        snapshotAt: new Date().toISOString(),
      }, 'periodic rich risk snapshot');
    } catch {}
  }

  // === Real Trade Reconciliation (drain after cycle trading) ===
  await reconcileRealTradesIfEnabled('post');

  if (process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true') {
    try {
      const { checkStalePendingSells } = await import('@/lib/monitoring/pending-sells');
      const { checkRunnerStall } = await import('@/lib/monitoring/runner-stall');
      const { repriceStalePendingSells } = await import('@/lib/monitoring/reprice-stale-sells');
      const { resolveNeedsReviewTrades } = await import('@/lib/monitoring/resolve-needs-review');
      await repriceStalePendingSells();
      await resolveNeedsReviewTrades();
      await checkStalePendingSells();
      await checkRunnerStall();
    } catch {
      // non-fatal
    }
  }

  // Grok + heavy research — background only (must not block the next cycle)
  const { runPostCycleIntelligence } = await import('@/lib/monitoring/post-cycle-intelligence');
  runPostCycleIntelligence({
    liveRealActive,
    cycleBankrollUsd,
    systemHealth,
    adverseRate,
    activeStrategyIds: activeStrategies.map((s) => s.id),
    allowedStrategyRows: allowedStrategies.map((s) => ({
      id: s.id,
      paperOnly: s.paperOnly,
    })),
  });

  // === Active Execution Management on Unhealthy Markets (recommendations + simulation) ===
  if (Math.random() < 0.08) {
    for (const marketId of unhealthyMarkets) {
      const action = executionManager.manageRestingOrders(marketId);
      if (action.type === 'CANCEL_ALL' || action.type === 'CANCEL_AND_REPOST') {
        console.warn(`[Runner] ACTION: ${action.type} recommended for ${marketId} — ${action.reason}`);
        
        const cancelled = executionManager.cancelOrdersForMarket(marketId);
        
        await logAudit('execution_management_action', {
          market: marketId,
          action: action.type,
          reason: action.reason,
          ordersCancelled: cancelled.length,
        });
      }
    }
  }
}

let liveRunnerWatchdogStarted = false;

/**
 * When live execution is enabled, restart the runner if it stops unexpectedly
 * (deploy, stale lock expiry, crash). Manual UI stop sets desired=stopped and
 * suppresses restarts until the operator starts again.
 */
export function startLiveRunnerWatchdog(): void {
  if (process.env.SNIPER_ENABLE_REAL_EXECUTION !== 'true') return;
  if (liveRunnerWatchdogStarted) return;
  liveRunnerWatchdogStarted = true;

  const tickMs = Math.max(
    15_000,
    parseInt(process.env.SNIPER_RUNNER_WATCHDOG_MS ?? '45000', 10) || 45_000,
  );

  setInterval(() => {
    void (async () => {
      try {
        const { shouldAutoStartRunner } = await import('@/lib/monitoring/runner-control');
        if (!(await shouldAutoStartRunner())) return;
        syncStatusFromStore();
        if (status.running) return;
        console.log('[Runner] Watchdog: live runner is off — attempting restart');
        const intervalMs = await getRunnerIntervalMs();
        await startRunner(intervalMs);
      } catch (err) {
        console.warn('[Runner] Watchdog restart failed (will retry):', err);
      }
    })();
  }, tickMs);

  console.log(`[Runner] Live watchdog armed (every ${tickMs / 1000}s)`);
}

async function logAudit(action: string, payload: Record<string, unknown>) {
  try {
    await db.insert(auditEvents).values({
      actor: 'runner',
      action,
      payload,
    });
  } catch {}
}
