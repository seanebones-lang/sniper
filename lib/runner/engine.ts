/**
 * Strategy Engine + Background Runner (Phase 3)
 * This is the core that makes the system "know when to buy and sell".
 *
 * Arch note: ~580 LOC orchestrates riskMode, portfolioRisk, executionManager, recon, Grok agent, snapshots, dynamic alloc.
 * If adding significantly more (e.g. full WS strategies), consider splitting into RiskOrchestrator + EvaluationLoop.
 */

import { db, signals, paperTrades, auditEvents, strategies } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { getAllMarkets, getMarketsForQuickFlip } from '@/lib/markets';
import { getStrategy } from '@/lib/strategies';
import { paperSimulator } from '@/lib/execution/paper-simulator';
import type { Market } from '@/lib/types';
import type { StrategyConfig } from '@/lib/strategies/types';
import { resolveStrategyConfig, shouldUseImmediateFill, type ResolvedStrategyConfig } from '@/lib/strategies/run-profile';
import { getOpenPositionsByStrategy, hydratePaperSimulatorFromDb } from '@/lib/paper/strategy-positions';
import { alerts } from '@/lib/alerts/telegram';
import { portfolioRiskManager } from '@/lib/risk/portfolio-manager';
import { rankQuickFlipMarkets, filterQuickFlipMarkets, QUICK_FLIP_MAX_RESOLUTION_HOURS } from '@/lib/markets/fast-moving';
import { getDynamicAllocations } from '@/lib/strategies/allocator';
import { getRecentSnapshotsBatch } from '@/lib/data/historical';
import { executionManager } from '@/lib/execution/execution-manager';
import { edgeDecayMonitor } from '@/lib/monitoring/edge-decay';
import { riskModeManager } from '@/lib/monitoring/risk-mode';
import { storeRecommendations } from '@/lib/monitoring/ai-recommendations';
import { loadPaperRiskState } from '@/lib/paper/risk-state';
import { computeStrategyPnlWindows, statsToPerformanceWindow } from '@/lib/paper/strategy-pnl';
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
    const config = resolveStrategyConfig(strat.config as unknown as StrategyConfig);
    if (config.tradingGoal === 'quick-flip' || strat.type === 'live-quick-flip') {
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

export async function startRunner(intervalMs = 15000) {
  syncStatusFromStore();
  if (status.running) return;

  const { applyPaperBudgetToRiskManager } = await import('@/lib/paper/portfolio');
  await applyPaperBudgetToRiskManager();
  await hydratePaperSimulatorFromDb();

  status.running = true;
  persistStatus();
  getRunnerBookHub().start();
  console.log('[Runner] Starting 24/7 paper runner...');

  // === Durable Safety State Recovery (critical for real capital) ===
  try {
    const { loadCriticalSafetyState, loadSystemState, loadRiskSnapshot } = await import('@/lib/monitoring/system-state');
    const safety = await loadCriticalSafetyState();

    if (safety.killSwitch.disabled) {
      console.warn('🚨 [Runner] KILL SWITCH RECOVERED FROM PERSISTED STATE');
      console.warn(`   Reason: ${safety.killSwitch.reason}`);
      console.warn(`   Disabled at: ${safety.killSwitch.disabledAt}`);
    }

    if (safety.riskMode.current !== 'NORMAL') {
      console.warn(`⚠️ [Runner] RISK MODE RECOVERED: ${safety.riskMode.current} — ${safety.riskMode.reason}`);
    }

    // Also surface last known execution health
    const execHealth = await loadSystemState<any>('execution_health_summary');
    if (execHealth?.unhealthyMarketCount > 0) {
      console.warn(`[Runner] Last known execution health had ${execHealth.unhealthyMarketCount} unhealthy markets (score ${(execHealth.systemHealthScore || 0).toFixed(2)})`);
    }

    // Load and log the last rich risk snapshot (very valuable after restarts)
    const lastRisk = await loadRiskSnapshot();
    if (lastRisk) {
      console.log(`[Runner] Recovered risk snapshot from ${lastRisk.snapshotAt}: Exposure $${lastRisk.totalExposureUsd.toFixed(0)} | Mode: ${lastRisk.currentRiskMode} | Health: ${(lastRisk.systemHealthScore * 100).toFixed(1)}%`);

      // Act on recovered bad state (important self-protection behavior)
      if (lastRisk.systemHealthScore < 0.55 || lastRisk.totalExposureUsd > 1200) {
        console.warn('⚠️ [Runner] STARTUP WARNING: Last known risk state was elevated. Starting with extra caution.');
        await logAudit('startup_elevated_risk_state', {
          snapshot: lastRisk,
          note: 'Runner is starting from a previously stressed risk posture',
        });
      }
    }
  } catch (e) {
    console.warn('[Runner] Could not load durable safety state (non-fatal):', e);
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
    if (cycleInFlight) {
      console.warn('[Runner] Skipping cycle — prior run still in flight');
    } else {
      cycleInFlight = true;
      try {
        await runOnce();
      } catch (e) {
        console.error('[Runner] Error in loop:', e);
      } finally {
        cycleInFlight = false;
      }
    }
    status.lastCycleDurationMs = Date.now() - cycleStart;
    persistStatus();
    if (!status.running) return;
    const baseInterval = await getRunnerIntervalMs();
    const delay = Math.max(baseInterval, status.lastCycleDurationMs ?? baseInterval);
    cycleTimeout = setTimeout(() => void scheduleNextCycle(), delay);
  };

  void scheduleNextCycle();

  persistStatus();
}

export function stopRunner() {
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
  console.log('[Runner] Stopped');
  alerts.runnerStopped();
}

export async function runOnce() {
  if (!status.running) return;

  incrementRunCount();

  const activeStrategies = await db.query.strategies.findMany({
    where: (s, { eq }) => eq(s.isActive, true),
  });

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

  const hasQuickFlipStrategy = activeStrategies.some((s) => {
    const cfg = resolveStrategyConfig(s.config as unknown as StrategyConfig);
    return cfg.tradingGoal === 'quick-flip' || s.type === 'live-quick-flip' || cfg.liveMarketsOnly;
  });

  const markets = hasQuickFlipStrategy
    ? await getMarketsForQuickFlip()
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

  // === Risk Mode Evaluation ===
  const decayingCount = activeStrategies.filter(s => edgeDecayMonitor.isDecaying(s.id).decaying).length;
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

  const allAllocations = await getDynamicAllocations(activeStrategies.map((s) => s.id));

  const bookCache = new CycleBookCache();
  const evalMarketsToFetch: Array<{ platform: string; externalId: string }> = [];
  const marketsToFetch: Array<{ platform: string; externalId: string }> = [];
  const marketByKey = new Map(markets.map((m) => [`${m.platform}:${m.externalId}`, m]));

  for (const stratRow of allowedStrategies) {
    const config = resolveStrategyConfig(stratRow.config as unknown as StrategyConfig);
    const isQuickFlipStrat =
      config.tradingGoal === 'quick-flip' || config.liveMarketsOnly || stratRow.type === 'live-quick-flip';
    const stratLimit = isQuickFlipStrat ? 40 : marketEvaluationLimit;

    let openPool = markets.filter((m) => m.status === 'open');
    if (isQuickFlipStrat) {
      openPool = filterQuickFlipMarkets(openPool);
      openPool = openPool.length > 0 ? rankQuickFlipMarkets(openPool) : [];
    }
    for (const m of openPool.slice(0, stratLimit)) {
      evalMarketsToFetch.push({ platform: m.platform, externalId: m.externalId });
      marketsToFetch.push({ platform: m.platform, externalId: m.externalId });
    }
  }

  const openPositionsByStrategy = await getOpenPositionsByStrategy(
    allowedStrategies.map((s) => s.id),
  );

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

  const snapshotBatch = await getRecentSnapshotsBatch(
    evalMarketsToFetch.map((m) => ({ platform: m.platform, marketExternalId: m.externalId })),
    8,
  );

  const liveRealActive =
    process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true' &&
    activeStrategies.some((s) => !s.paperOnly);

  if (liveRealActive) {
    const { getPolymarketPrivateKey, getPolymarketUsdcBalance } = await import(
      '@/lib/clients/polymarket-trading'
    );
    const { loadRealRiskSnapshot } = await import('@/lib/risk/real-bankroll');
    const pk = getPolymarketPrivateKey();
    let balanceUsd: number | null = null;
    if (pk) {
      balanceUsd = await getPolymarketUsdcBalance(pk, { syncFirst: false });
      if (balanceUsd == null) {
        const snap = (await import('@/lib/clients/polymarket-trading-setup'))
          .getPolymarketSetupSnapshot();
        balanceUsd = snap?.balanceUsd ?? null;
      }
      if (balanceUsd == null) {
        balanceUsd = await getPolymarketUsdcBalance(pk, { syncFirst: true });
      }
    }
    if (balanceUsd == null || balanceUsd <= 0) {
      const snap = (await import('@/lib/clients/polymarket-trading-setup')).getPolymarketSetupSnapshot();
      balanceUsd = snap?.balanceUsd ?? null;
    }
    if (balanceUsd != null && balanceUsd > 0) {
      portfolioRiskManager.applyMicroRealBudget(balanceUsd);
      const realRisk = await loadRealRiskSnapshot(balanceUsd);
      portfolioRiskManager.setCyclePortfolioState(realRisk.state, realRisk.equityUsd);
    } else {
      console.warn('[Runner] Live mode: could not read Polymarket balance — using paper risk caps (orders may be blocked)');
      const paperRisk = await loadPaperRiskState(bookCache.toMarkPriceMap());
      portfolioRiskManager.setCyclePortfolioState(
        paperRisk.state,
        paperRisk.equityUsd,
        paperRisk.ledger.realizedPnLUsd,
      );
    }
  } else {
    const paperRisk = await loadPaperRiskState(bookCache.toMarkPriceMap());
    const { getPaperBudgetSettings } = await import('@/lib/settings/paper-budget');
    const { applyPaperBudgetToPortfolioManager } = await import('@/lib/risk/portfolio-manager');
    applyPaperBudgetToPortfolioManager(await getPaperBudgetSettings());
    portfolioRiskManager.setCyclePortfolioState(
      paperRisk.state,
      paperRisk.equityUsd,
      paperRisk.ledger.realizedPnLUsd,
    );
  }

  const activeProfiles: ActiveStrategyProfile[] = activeStrategies.map((s) => {
    const cfg = resolveStrategyConfig(s.config as unknown as StrategyConfig);
    return {
      id: s.id,
      name: s.name,
      type: s.type,
      tradingStyle: cfg.tradingStyle,
      tradingGoal: cfg.tradingGoal,
      maxSizeUsd: cfg.maxSizeUsd,
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

  let signalsThisRun = 0;
  let fillsThisRun = 0;

  for (const stratRow of allowedStrategies) {
    const strategyImpl = getStrategy(stratRow.type);
    if (!strategyImpl) continue;

    const config = resolveStrategyConfig(stratRow.config as unknown as StrategyConfig);
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
      stratMarketLimit = 40;
      const candidates = filterQuickFlipMarkets(openPool);
      openPool = candidates.length > 0 ? rankQuickFlipMarkets(candidates) : [];
      if (openPool.length === 0) {
        console.warn(`[Runner] Quick-flip "${stratRow.name}": no markets resolving within ${QUICK_FLIP_MAX_RESOLUTION_HOURS}h this cycle`);
      }
    }

    const relevantMarkets = openPool.slice(0, stratMarketLimit);
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
    for (const pos of openPositions) {
      const key = `${pos.platform}:${pos.marketExternalId}`;
      if (!marketKeys.has(key)) {
        const found = markets.find(
          (m) => m.platform === pos.platform && m.externalId === pos.marketExternalId,
        );
        if (found) {
          relevantMarkets.push(found);
          marketKeys.add(key);
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
      const realBuyQueued =
        process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true' &&
        queuedSignals.some((q) => !q.stratRow.paperOnly && q.signal.action === 'BUY');
      if (realBuyQueued) {
        try {
          const { getPolymarketPrivateKey, getPolymarketUsdcBalance } = await import(
            '@/lib/clients/polymarket-trading'
          );
          const pk = getPolymarketPrivateKey();
          realCashRemaining = pk
            ? (await getPolymarketUsdcBalance(pk, { syncFirst: false })) ?? 0
            : 0;
        } catch {
          realCashRemaining = Number.POSITIVE_INFINITY;
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
          // Skip BUYs we can't fund — keeps the CLOB from rejecting a flood of
          // over-budget orders. Exits (SELL) always proceed; they free cash.
          const estimatedUsd = q.signal.price * q.finalSize;
          if (q.signal.action === 'BUY' && estimatedUsd > realCashRemaining + 1e-9) {
            void logAudit('runner_real_skipped_no_cash', {
              strategy: q.stratRow.name,
              market: q.market.externalId,
              estimatedUsd,
              realCashRemaining,
            });
            continue;
          }

          const { placeRealOrder } = await import('@/lib/execution/real-executor');
          const result = await placeRealOrder({
            market: q.market,
            side: q.signal.action as 'BUY' | 'SELL',
            price: q.signal.price,
            size: q.finalSize,
            edge: q.signal.edge,
            confidence: q.signal.confidence,
            isExit: q.isExitSignal,
            book: q.book ?? undefined,
            takeLiquidity: q.isQuickFlip && q.signal.action === 'BUY',
            maxNotionalUsd: q.config.maxSizeUsd,
            reason: `[REAL][${q.stratRow.name}] ${q.signal.reason} (risk-adjusted)`,
          });

          if (result.success) {
            fillsThisRun++;
            if (q.signal.action === 'BUY') {
              realCashRemaining -= estimatedUsd;
            }
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
          } else if (isRealAllowed) {
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

            void db.insert(paperTrades).values({
              platform: q.market.platform,
              marketExternalId: q.market.externalId,
              signalId: signalId ?? null,
              side: fill.side,
              price: fill.price.toString(),
              size: fill.size.toString(),
              fee: fill.fee.toString(),
              status: 'filled',
            });

            alerts.paperFill(fill);
          }
        }
      }
    }
  }

  status.lastRun = new Date().toISOString();
  status.signalsGenerated += signalsThisRun;
  status.fillsExecuted += fillsThisRun;
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

  portfolioRiskManager.clearCycleCache();

  if (signalsThisRun > 0) {
    console.log(`[Runner] Run complete. Signals: ${signalsThisRun}, Fills: ${fillsThisRun}`);
  }

  // === Edge Decay Monitoring — feed rolling PnL windows (every 5 cycles) ===
  if (getCurrentRunCount() % 5 === 0) {
    try {
      const pnlStats = await computeStrategyPnlWindows(
        activeStrategies.map((s) => s.id),
        6,
      );
      for (const [, stats] of pnlStats) {
        if (stats.fills >= 3) {
          edgeDecayMonitor.recordWindow(stats.strategyId, statsToPerformanceWindow(stats, 6));
        }
      }
    } catch (e) {
      console.warn('[Runner] Edge decay window update failed (non-fatal):', e);
    }
  }

  for (const strat of activeStrategies) {
    const decay = edgeDecayMonitor.isDecaying(strat.id);
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
    const state = await portfolioRiskManager.getCurrentPortfolioState();
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

  // === Real Trade Reconciliation (important for live execution) ===
  if (process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true') {
    try {
      const { reconcilePendingRealTrades } = await import('@/lib/execution/reconcile-real-trades');
      const recon = await reconcilePendingRealTrades();
      if (recon.checked > 0) {
        console.log(`[Runner] Real trade reconciliation: checked=${recon.checked}, updated=${recon.updated}, errors=${recon.errors}`);
      }
    } catch (reconErr) {
      console.warn('[Runner] Reconciliation error (non-fatal):', reconErr);
    }
  }

  // === Automated Intelligence Layer: Periodic Grok Analysis with Concrete Actions ===
  const { getGrokResearchEnabled } = await import('@/lib/settings/keys');
  const grokResearchEnabled = await getGrokResearchEnabled();
  const shouldRunGrokAnalysis = grokResearchEnabled &&
    (Math.random() < 0.008 || (Date.now() % (6 * 60 * 60 * 1000) < 120000)); // ~every 6h or on lucky runs

  if (shouldRunGrokAnalysis) {
    try {
      const { askGrokResearchAgent } = await import('@/lib/research/grok-agent');

      // Build rich context for the agent
      const recentExec = executionManager.getRecentExecutionQuality(20);
      const avgSlip = executionManager.getAverageSlippage(30);
      const unhealthy = executionManager.getUnhealthyMarkets(0.5);
      const currentRisk = riskModeManager.getCurrentMode();

      const primaryStrategy = activeStrategies[0];

      const analysis = await askGrokResearchAgent({
        type: 'strategy_analysis',
        strategyId: primaryStrategy?.id,
        lookbackHours: 48,
        extraContext: `Current risk mode: ${currentRisk.current} (${currentRisk.reason}). 
System health score: ${(systemHealth * 100).toFixed(1)}%. 
Recent adverse fill rate: ${(adverseRate * 100).toFixed(1)}%. 
Unhealthy markets: ${unhealthy.length} (${unhealthy.join(', ') || 'none'}). 
Avg recent slippage: ${avgSlip.toFixed(4)}. 
Recent execution samples: ${JSON.stringify(recentExec.slice(-8))}`,
      });

      await logAudit('grok_research_agent', { 
        fullAnalysis: analysis.analysis.slice(0, 2000),
        proposals: analysis.proposals || [],
        riskModeAtTime: currentRisk.current,
      });

      console.log('[Runner] Grok Research Agent analysis completed.');

      // Parse and surface concrete recommendations
      if (analysis.analysis.includes('RECOMMENDED ACTIONS')) {
        const actionsSection = analysis.analysis.split('RECOMMENDED ACTIONS')[1] || '';
        console.warn(`[Runner] Grok Recommended Actions:\n${actionsSection.trim().slice(0, 1200)}`);

        const stored = storeRecommendations(actionsSection, currentRisk.current);

        await logAudit('grok_recommended_actions', {
          raw: actionsSection.trim().slice(0, 1500),
          riskMode: currentRisk.current,
          parsedCount: stored.parsedActions.length,
        });

        // Auto-apply safe recommendations and create temporary adjustments
        for (const action of stored.parsedActions) {
          const a = action.action.toLowerCase().replace(/_/g, ' ');
          const target = action.target;
          const value = typeof action.value === 'number' ? action.value : 0.7; // default safe reduction

          if ((a.includes('reduce') && a.includes('risk')) || a.includes('defensive')) {
            if (systemHealth < 0.6 || currentRisk.current !== 'NORMAL') {
              const expires = 12; // ~12 runs (~2-3 hours depending on frequency)
              applyTemporaryAdjustment({
                type: 'global_risk_multiplier',
                value: Math.max(0.3, value),
                reason: `Grok auto: ${action.reason}`,
                expiresAfterRuns: expires,
                source: 'grok_auto',
              });
              console.warn(`[Runner] Auto-applied temporary risk reduction from Grok (expires in ~${expires} runs)`);
              await logAudit('grok_auto_applied', { 
                action: action.action, 
                target, 
                value: Math.max(0.3, value),
                expiresAfterRuns: expires 
              });
            }
          }

          const strategyId = target.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];

          if (a.includes('pause') && a.includes('strategy') && strategyId) {
            await db.update(strategies)
              .set({ isActive: false, updatedAt: new Date() })
              .where(eq(strategies.id, strategyId));
            console.warn(`[Runner] Paused strategy ${strategyId} per Grok recommendation`);
            await logAudit('grok_auto_applied', {
              action: action.action,
              target: strategyId,
              effect: 'isActive=false',
              reason: action.reason,
            });
            continue;
          }

          if (a.includes('reduce') && a.includes('allocation') && strategyId) {
            const downweight = Math.max(0.1, Math.min(1, value));
            const expires = 40;
            applyTemporaryAdjustment({
              type: 'strategy_downweight',
              target: strategyId,
              value: downweight,
              reason: `Grok auto: ${action.reason}`,
              expiresAfterRuns: expires,
              source: 'grok_auto',
            });
            const strat = await db.query.strategies.findFirst({ where: eq(strategies.id, strategyId) });
            if (strat) {
              const cfg = (strat.config ?? {}) as Record<string, unknown>;
              await db.update(strategies)
                .set({
                  config: { ...cfg, allocationDownweight: downweight },
                  updatedAt: new Date(),
                })
                .where(eq(strategies.id, strategyId));
            }
            console.warn(`[Runner] Reduced allocation for ${strategyId} to ${downweight}x`);
            await logAudit('grok_auto_applied', {
              action: action.action,
              target: strategyId,
              value: downweight,
              expiresAfterRuns: expires,
            });
            continue;
          }

          if (a.includes('downweight') || (a.includes('pause') && !strategyId)) {
            const expires = 20;
            applyTemporaryAdjustment({
              type: 'strategy_downweight',
              target: target,
              value: a.includes('pause') ? 0.1 : Math.max(0.2, value),
              reason: `Grok auto: ${action.reason}`,
              expiresAfterRuns: expires,
              source: 'grok_auto',
            });
            console.warn(`[Runner] Auto-applied temporary strategy adjustment for ${target}`);
            await logAudit('grok_auto_applied', { action: action.action, target, expiresAfterRuns: expires });
          }
        }

        // Send high-priority recommendations via Telegram
        if (stored.parsedActions.some(a => 
            a.action.toLowerCase().includes('pause') || 
            a.action.toLowerCase().includes('emergency') ||
            a.action.toLowerCase().includes('reduce'))) {
          const summary = stored.parsedActions.map(a => 
            `- ${a.action} on ${a.target}: ${a.reason}`
          ).join('\n');
          alerts.error(`Grok Recommendation:\n${summary}`);
        }
      }
    } catch (e) {
      console.warn('[Runner] Grok Research Agent call failed (non-fatal):', e);
    }
  }

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

async function logAudit(action: string, payload: Record<string, unknown>) {
  try {
    await db.insert(auditEvents).values({
      actor: 'runner',
      action,
      payload,
    });
  } catch {}
}
