import { ensureMarketRecord } from '@/lib/markets';
import { extractFeaturesFromRecentSnapshots } from '@/lib/data/features';
import { saveBookSnapshot } from '@/lib/data/historical';
import { categorizeMarket } from '@/lib/risk/categorizer';
import { computeFinalShareSize } from '@/lib/risk/sizing';
import { portfolioRiskManager } from '@/lib/risk/portfolio-manager';
import { executionManager } from '@/lib/execution/execution-manager';
import { evaluateExitSignal, type StrategyOpenPosition } from '@/lib/strategies/exit-engine';
import { getStrategySizeMultiplier } from '@/lib/monitoring/temporary-adjustments';
import type { ResolvedStrategyConfig } from '@/lib/strategies/run-profile';
import type { Strategy, StrategySignal } from '@/lib/strategies/types';
import type { Market } from '@/lib/types';
import type { CycleBookCache } from '@/lib/runner/book-cache';

export interface QueuedRunnerSignal {
  stratRow: { id: string; name: string; type: string; paperOnly: boolean | null };
  market: Market;
  signal: StrategySignal;
  config: ResolvedStrategyConfig;
  book: import('@/lib/types').OrderBook | null | undefined;
  advancedRegime: string | undefined;
  finalSize: number;
  isExitSignal: boolean;
  isQuickFlip: boolean;
  marketDbId: string;
  cooldownKey: string;
  healthMultiplier: number;
  sizeReason: string;
}

export interface EvaluateMarketContext {
  stratRow: { id: string; name: string; type: string; paperOnly: boolean | null };
  strategyImpl: Strategy;
  config: ResolvedStrategyConfig;
  allocation: { maxSizeMultiplier: number; reason: string };
  openByMarket: Map<string, StrategyOpenPosition>;
  bookCache: CycleBookCache;
  snapshotBatch: Map<string, Array<{ mid?: string | number | null; imbalance?: string | number | null }>>;
  marketDbIds: Map<string, string>;
  lastSignalAtByKey: Map<string, number>;
  globalRiskMultiplier: number;
}

function shouldSaveSnapshot(platform: string, externalId: string): boolean {
  let h = platform.length;
  for (let i = 0; i < externalId.length; i++) h += externalId.charCodeAt(i);
  return h % 3 === 0;
}

export async function evaluateMarketForStrategy(
  market: Market,
  ctx: EvaluateMarketContext,
): Promise<QueuedRunnerSignal | null> {
  const {
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
  } = ctx;

  const book = bookCache.getBook(market.platform, market.externalId);
  const currentPrice =
    book?.mid ?? bookCache.getMarkPrice(market.platform, market.externalId) ?? market.lastPrice;

  const recentSnaps = snapshotBatch.get(`${market.platform}:${market.externalId}`) ?? [];
  const advanced = extractFeaturesFromRecentSnapshots(recentSnaps);

  const marketHealth = executionManager.getMarketHealth(market.externalId);
  let healthMultiplier = 1.0;
  if (marketHealth.healthScore < 0.5) {
    healthMultiplier = Math.max(0.15, marketHealth.healthScore * 0.8);
  }

  if (book && (book.bids?.length || book.asks?.length) && shouldSaveSnapshot(market.platform, market.externalId)) {
    const topBid = book.bids?.[0]?.size || 0;
    const topAsk = book.asks?.[0]?.size || 0;
    const imbalance = topBid / (topBid + topAsk + 0.0001);
    void saveBookSnapshot({
      platform: market.platform,
      marketExternalId: market.externalId,
      bids: book.bids?.slice(0, 3) || [],
      asks: book.asks?.slice(0, 3) || [],
      mid: book.mid || currentPrice || 0,
      spread: book.spread || 0,
      timestamp: new Date(),
      imbalance: parseFloat(imbalance.toFixed(4)),
      topDepth: topBid + topAsk,
      extra: {
        regime: advanced.regime,
        volatilityProxy: advanced.volatilityProxy,
        imbalancePersistence: advanced.imbalancePersistence,
      },
    } as unknown as Parameters<typeof saveBookSnapshot>[0]);
  }

  const posKey = `${market.platform}:${market.externalId}`;
  const openPos = openByMarket.get(posKey);

  let signal: StrategySignal | null = null;
  let isExitSignal = false;

  if (openPos && currentPrice) {
    signal = evaluateExitSignal(
      openPos,
      currentPrice,
      book?.spread,
      book?.mid ?? currentPrice,
      config,
    );
    isExitSignal = signal?.action === 'SELL';
  }

  if (!signal) {
    if (openPos && !config.allowScaleIn) {
      return null;
    }
    signal = strategyImpl.evaluate(
      { market, book: book ?? undefined, currentPrice, regime: advanced.regime },
      config,
    );
    if (signal?.action === 'SELL') {
      isExitSignal = true;
    }
  }

  if (!signal || signal.action === 'HOLD' || signal.action === 'CANCEL') {
    return null;
  }

  const cooldownKey = `${stratRow.id}:${market.platform}:${market.externalId}`;
  const cooldownMs = (config.cooldownSeconds ?? 300) * 1000;
  if (signal.action === 'BUY' && !isExitSignal) {
    const lastAt = lastSignalAtByKey.get(cooldownKey);
    if (lastAt != null && Date.now() - lastAt < cooldownMs) {
      return null;
    }
  }

  let orderSize = signal.size;
  if (signal.action === 'SELL' && openPos) {
    orderSize = Math.min(orderSize, Math.floor(openPos.netSize));
    if (orderSize <= 0) return null;
  }

  const isQuickFlip = config.tradingGoal === 'quick-flip' || stratRow.type === 'live-quick-flip';

  const categoryInfo = categorizeMarket(market.question, market.platform, market.externalId);
  const riskDecision = await portfolioRiskManager.calculateSafeSize({
    platform: market.platform,
    marketExternalId: market.externalId,
    side: signal.action as 'BUY' | 'SELL',
    edge: signal.edge ?? (signal.confidence ? (signal.confidence - 0.5) * 2 : 0.025),
    confidence: signal.confidence ?? 0.65,
    category: categoryInfo.category,
    currentPrice: signal.price,
    isExit: isExitSignal,
  });

  const minAllowedUsd = isQuickFlip ? 0.5 : 5;
  if (riskDecision.allowedSize < minAllowedUsd) {
    return null;
  }

  let allocatorMultiplier = allocation.maxSizeMultiplier || 0.85;
  if (typeof config.allocationDownweight === 'number' && config.allocationDownweight > 0) {
    allocatorMultiplier *= Math.max(0.05, Math.min(1, config.allocationDownweight));
  }
  allocatorMultiplier = getStrategySizeMultiplier(stratRow.id, allocatorMultiplier);

  const riskCapUsd =
    riskDecision.allowedSize * allocatorMultiplier * healthMultiplier * globalRiskMultiplier;

  const finalSize = computeFinalShareSize({
    requestedShares: orderSize,
    riskCapUsd:
      isQuickFlip && signal.action === 'BUY'
        ? Math.min(config.maxSizeUsd, riskCapUsd)
        : riskCapUsd,
    price: signal.price,
    isQuickFlipBuy: isQuickFlip && signal.action === 'BUY',
    minSharesUsd: isQuickFlip ? 0.5 : 1,
  });

  if (finalSize <= 0) return null;

  let sizeReason = '';
  if (healthMultiplier < 0.95) sizeReason += ` | Health throttle ${healthMultiplier.toFixed(2)}`;
  if (globalRiskMultiplier < 0.95) sizeReason += ` | Global risk ${globalRiskMultiplier.toFixed(2)}`;

  const marketKey = `${market.platform}:${market.externalId}`;
  let marketDbId = marketDbIds.get(marketKey);
  if (!marketDbId) {
    marketDbId = await ensureMarketRecord(market);
    marketDbIds.set(marketKey, marketDbId);
  }

  return {
    stratRow,
    market,
    signal,
    config,
    book,
    advancedRegime: advanced.regime,
    finalSize,
    isExitSignal,
    isQuickFlip,
    marketDbId,
    cooldownKey,
    healthMultiplier,
    sizeReason,
  };
}
