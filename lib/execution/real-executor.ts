/**
 * Real Executor (Phase 4)
 * 
 * ONLY called when:
 * - SNIPER_ENABLE_REAL_EXECUTION=true in environment
 * - Strategy explicitly allows real (paperOnly=false)
 * - Risk engine approves
 * 
 * This is intentionally minimal and heavily logged.
 */

import { db, realTrades, auditEvents } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { riskEngine } from '@/lib/risk/engine';
import { portfolioRiskManager } from '@/lib/risk/portfolio-manager';
import type { Market, OrderBook } from '@/lib/types';
import { getPolymarketPrivateKey } from '@/lib/clients/polymarket-trading';
import { getKalshiTradingClient } from '@/lib/clients/kalshi-trading';
import { executionManager } from './execution-manager';
import { categorizeMarket } from '@/lib/risk/categorizer';
import {
  loadKillSwitchState,
  persistKillSwitchDisabled,
  persistKillSwitchEnabled,
} from '@/lib/monitoring/system-state';

const REAL_ENABLED = process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true';

/** After CLOB 403 geoblock, pause new attempts to avoid log/DB spam until session/proxy is fixed. */
let clobGeoblockBackoffUntil = 0;
let lastGeoblockHintAt = 0;

// Kill switch support (now durable for 24/7 real capital safety)
// Priority (highest first):
// 1. SNIPER_DISABLE_REAL_EXECUTION env var (deployment-level, survives everything)
// 2. Persisted runtime disable (survives restarts/deploys)
// 3. SNIPER_ENABLE_REAL_EXECUTION env var (positive enable)
let realExecutionGloballyDisabled = false; // hot cache

export async function disableRealExecution(reason = 'Manual runtime disable') {
  realExecutionGloballyDisabled = true;
  await persistKillSwitchDisabled(reason, 'runtime');
}

export async function enableRealExecution(reason = 'Manual runtime re-enable') {
  realExecutionGloballyDisabled = false;
  await persistKillSwitchEnabled(reason);
}

export async function isRealExecutionAllowed(): Promise<boolean> {
  if (process.env.SNIPER_DISABLE_REAL_EXECUTION === 'true') {
    return false;
  }

  // Check hot cache first
  if (realExecutionGloballyDisabled) {
    return false;
  }

  // On cold start or after possible external change, check durable state
  try {
    const persisted = await loadKillSwitchState();
    if (persisted.disabled) {
      realExecutionGloballyDisabled = true; // hydrate cache
      return false;
    }
  } catch {
    // If DB is unavailable we conservatively allow the env gate only
  }

  return REAL_ENABLED;
}

export interface RealExecutionStatus {
  allowed: boolean;
  envEnabled: boolean;
  killSwitchEnv: boolean;
  hasPolymarketKey: boolean;
  pendingRealTrades: number;
  blockers: string[];
  geoblock?: import('@/lib/clients/polymarket-geoblock').PolymarketGeoblockResult;
}

export async function getRealExecutionStatus(): Promise<RealExecutionStatus> {
  const allowed = await isRealExecutionAllowed();
  const blockers: string[] = [];

  if (process.env.SNIPER_ENABLE_REAL_EXECUTION !== 'true') {
    blockers.push('SNIPER_ENABLE_REAL_EXECUTION is not true');
  }
  if (process.env.SNIPER_DISABLE_REAL_EXECUTION === 'true') {
    blockers.push('SNIPER_DISABLE_REAL_EXECUTION is true');
  }
  if (!getPolymarketPrivateKey()) {
    blockers.push('POLYMARKET_PRIVATE_KEY is not set');
  }
  if (!allowed && process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true') {
    blockers.push('Kill switch or durable disable is active');
  }

  const { checkPolymarketGeoblock, formatGeoblockMessage } = await import(
    '@/lib/clients/polymarket-geoblock'
  );
  const geoblock = await checkPolymarketGeoblock({ ignoreSkip: true });
  if (geoblock.blocked) {
    blockers.push(formatGeoblockMessage(geoblock));
  } else if (geoblock.skipped) {
    blockers.push(formatGeoblockMessage(geoblock));
  }

  const pending = await db.query.realTrades.findMany({
    where: (t, { eq }) => eq(t.status, 'pending'),
    columns: { id: true },
    limit: 100,
  });

  return {
    allowed,
    envEnabled: process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true',
    killSwitchEnv: process.env.SNIPER_DISABLE_REAL_EXECUTION === 'true',
    hasPolymarketKey: !!getPolymarketPrivateKey(),
    pendingRealTrades: pending.length,
    blockers,
    geoblock,
  };
}

export interface RealOrderRequest {
  market: Market;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  reason: string;
  /** From strategy signal — must match runner sizing (placeholder edge blocks all micro orders). */
  edge?: number;
  confidence?: number;
  isExit?: boolean;
  /** Live order book for the market. Required for a sensible execution decision —
   *  without it the execution manager returns WAIT ("insufficient book depth")
   *  and the order is cancelled. */
  book?: OrderBook | null;
  /** Lift the ask/bid now (quick-flip entries). */
  takeLiquidity?: boolean;
  /** Strategy max notional (USD) — used for micro live accounts. */
  maxNotionalUsd?: number;
}

/**
 * Place a real order.
 * This is the actual execution path — only called when every gate is satisfied.
 */
export async function placeRealOrder(req: RealOrderRequest): Promise<{ success: boolean; tradeId?: string; error?: string }> {
  if (!(await isRealExecutionAllowed())) {
    return { success: false, error: 'Real execution disabled (kill-switch or env flag)' };
  }

  if (req.market.platform === 'polymarket') {
    if (Date.now() < clobGeoblockBackoffUntil) {
      return {
        success: false,
        error:
          'CLOB rejected orders (region/WAF). Open /real → paste cf_clearance + User-Agent, or use a residential EU proxy.',
      };
    }

    const { checkPolymarketGeoblock, formatGeoblockMessage } = await import(
      '@/lib/clients/polymarket-geoblock'
    );
    const geo = await checkPolymarketGeoblock({ ignoreSkip: true });
    if (geo.blocked) {
      await logAudit('real_order_blocked_geoblock', { ...geo });
      return { success: false, error: formatGeoblockMessage(geo) };
    }

    const pk = getPolymarketPrivateKey();
    if (pk) {
      const { getPolymarketUsdcBalance } = await import('@/lib/clients/polymarket-trading');
      const { loadRealRiskSnapshot } = await import('@/lib/risk/real-bankroll');
      const balanceUsd = await getPolymarketUsdcBalance(pk, { syncFirst: false });
      if (balanceUsd != null && balanceUsd > 0) {
        portfolioRiskManager.applyMicroRealBudget(balanceUsd);
        const realRisk = await loadRealRiskSnapshot(balanceUsd);
        portfolioRiskManager.setCyclePortfolioState(realRisk.state, realRisk.equityUsd);
      }
    }
  }

  const { usdCapToShares, minRealOrderUsd } = await import('@/lib/risk/sizing');
  const bankrollUsd = portfolioRiskManager.getCurrentBankroll();
  const minOrderUsd = minRealOrderUsd(bankrollUsd);
  const requestedUsd = req.price * req.size;

  let finalSize: number;
  let usdValue: number;

  // Micro live (~$7): trust strategy cap ($1) instead of paper-era Kelly ($5 min).
  const microLive =
    !req.isExit &&
    bankrollUsd > 0 &&
    bankrollUsd <= 25 &&
    req.market.platform === 'polymarket';
  const strategyCap = req.maxNotionalUsd ?? 1;
  const microCapUsd = Math.min(requestedUsd, strategyCap, bankrollUsd * 0.9);

  if (microLive && microCapUsd >= minOrderUsd) {
    finalSize = usdCapToShares(microCapUsd, req.price, 1);
    usdValue = req.price * finalSize;
  } else {
    const safeSizing = await portfolioRiskManager.calculateSafeSize({
      platform: req.market.platform,
      marketExternalId: req.market.externalId,
      side: req.side,
      edge: req.edge ?? 0.03,
      confidence: req.confidence ?? 0.7,
      category: categorizeMarket(req.market.question || '', req.market.platform, req.market.externalId).category,
      currentPrice: req.price,
      isExit: req.isExit,
    });

    if (safeSizing.allowedSize < minOrderUsd) {
      await logAudit('real_order_blocked_portfolio_risk', {
        ...req,
        reason: safeSizing.reason,
        suggestedSize: safeSizing.allowedSize,
        bankrollUsd,
      });
      return { success: false, error: `Portfolio risk rejected: ${safeSizing.reason}` };
    }

    const cappedUsd = Math.min(requestedUsd, safeSizing.allowedSize);
    const targetUsd = Math.max(cappedUsd, Math.min(requestedUsd, minOrderUsd));
    finalSize = usdCapToShares(targetUsd, req.price, 1);
    usdValue = req.price * finalSize;

    if (finalSize <= 0 || usdValue < minOrderUsd * 0.99) {
      await logAudit('real_order_blocked_portfolio_risk', {
        ...req,
        reason: 'Size below minimum after USD conversion',
        suggestedSize: safeSizing.allowedSize,
        bankrollUsd,
      });
      return { success: false, error: 'Portfolio risk rejected: size too small' };
    }
  }

  // 1. Legacy risk engine gate (still useful as second layer). Align its
  // per-trade ceiling with the configured real-money cap so it doesn't reject
  // orders the cap already allows.
  const risk = riskEngine.checkRisk({
    platform: req.market.platform,
    marketExternalId: req.market.externalId,
    side: req.side,
    price: req.price,
    size: finalSize,
    usdValue,
  }, { maxUsdPerTrade: Math.max(maxRealUsdPerTrade, minRealUsd) });

  if (!risk.allowed) {
    await logAudit('real_order_blocked_risk', { ...req, reason: risk.reason });
    return { success: false, error: risk.reason };
  }

  if (req.market.platform === 'polymarket') {
    const { ensurePolymarketTradingReady } = await import(
      '@/lib/clients/polymarket-trading-setup'
    );
    const setup = await ensurePolymarketTradingReady();
    if (!setup.ready && req.side === 'BUY') {
      await logAudit('real_order_blocked_trading_not_ready', {
        ...setup,
        requiredUsd: usdValue,
        market: req.market.externalId,
      });
      return {
        success: false,
        error: setup.message ?? 'Polymarket trading not ready (balance/approvals)',
      };
    }
    if (
      req.side === 'BUY' &&
      setup.balanceUsd != null &&
      setup.balanceUsd < usdValue * 0.95
    ) {
      await logAudit('real_order_blocked_insufficient_balance', {
        balanceUsd: setup.balanceUsd,
        requiredUsd: usdValue,
        market: req.market.externalId,
      });
      return {
        success: false,
        error: `Insufficient Polymarket collateral ($${setup.balanceUsd.toFixed(2)} available, need ~$${usdValue.toFixed(2)})`,
      };
    }
  }

  // Record the intent first (audit trail)
  const [trade] = await db.insert(realTrades).values({
    platform: req.market.platform,
    marketExternalId: req.market.externalId,
    side: req.side,
    price: req.price.toString(),
    size: finalSize.toString(),
    fee: (usdValue * 0.0005).toString(),
    status: 'pending',
  }).returning();

  await logAudit('real_order_attempt', {
    tradeId: trade.id,
    ...req,
    usdValue,
  });

  // === ExecutionManager Decision ===
  // In a real implementation we would pass the live book here
  const book = req.book
    ? { ...req.book, marketExternalId: req.market.externalId }
    : null;
  const topBid = book?.bids?.[0]?.size ?? 0;
  const topAsk = book?.asks?.[0]?.size ?? 0;
  const recentImbalance =
    topBid + topAsk > 0 ? (topBid - topAsk) / (topBid + topAsk) : 0;

  let decision = executionManager.decideExecution(
    { action: req.side, price: req.price, size: finalSize, reason: req.reason },
    book, // normalized live book from the runner; null → execution manager WAITs
    {
      regime: 'normal',
      recentImbalance,
      timeSinceSignal: 0,
      isRealMoney: true,
      openOrders: executionManager.getOpenOrdersForMarket(req.market.externalId),
    }
  );

  if (req.takeLiquidity && req.side === 'BUY' && book?.asks?.length) {
    decision = {
      type: 'TAKE_AGGRESSIVE',
      price: req.price,
      size: finalSize,
      reason: 'Quick-flip entry — lift ask',
    };
  }

  await logAudit('execution_manager_decision', {
    tradeId: trade.id,
    decision,
  });

  if (decision.type === 'CANCEL_ALL' || decision.type === 'WAIT') {
    await db.update(realTrades).set({ status: 'cancelled' }).where(eq(realTrades.id, trade.id));
    return { success: false, error: decision.reason };
  }

  // 2. Polymarket execution
  if (req.market.platform === 'polymarket') {
    const privateKey = getPolymarketPrivateKey();
    if (!privateKey) {
      const msg = 'POLYMARKET_PRIVATE_KEY not set in environment';
      await db.update(realTrades).set({ status: 'rejected' }).where(eq(realTrades.id, trade.id));
      return { success: false, error: msg };
    }

    const execPrice = decision.type === 'POST_PASSIVE' || decision.type === 'TAKE_AGGRESSIVE'
      ? decision.price
      : req.price;
    const postOnly = decision.type === 'POST_PASSIVE';

    const { placePolymarketLimitOrder, placePolymarketMarketOrder } = await import(
      '@/lib/clients/polymarket-trading'
    );
    const { isPolymarketGeoblockOrderError } = await import('@/lib/clients/polymarket-geoblock');

    const result =
      req.takeLiquidity && req.side === 'BUY'
        ? await placePolymarketMarketOrder({
            privateKey,
            tokenId: req.market.externalId,
            amountUsd: Math.min(usdValue, req.maxNotionalUsd ?? usdValue),
            side: 'BUY',
            orderType: 'FOK',
          })
        : await placePolymarketLimitOrder({
            privateKey,
            tokenId: req.market.externalId,
            price: Math.max(0.01, Math.min(0.99, execPrice)),
            size: finalSize,
            side: req.side,
            postOnly,
          });

    if (result.success) {
      executionManager.recordOrderPosted(
        req.market.externalId,
        req.side,
        execPrice,
        finalSize,
      );
    }

    // For limit orders we optimistically set to 'pending' so reconciliation can later confirm the fill.
    // Market orders or immediate fills can be marked filled, but we keep it simple and consistent here.
    const newStatus = result.success ? 'pending' : 'rejected';

    await db.update(realTrades)
      .set({ 
        status: newStatus,
        txHash: result.orderId || undefined,
      })
      .where(eq(realTrades.id, trade.id));

    await logAudit('real_order_result', { tradeId: trade.id, finalSize, usdValue, ...result });

    if (!result.success && isPolymarketGeoblockOrderError(result.raw)) {
      clobGeoblockBackoffUntil = Date.now() + 5 * 60 * 1000;
      if (Date.now() - lastGeoblockHintAt > 60_000) {
        lastGeoblockHintAt = Date.now();
        console.warn(
          '[Polymarket] CLOB geoblock/WAF — pausing real orders 5m. Fix: /real → Cloudflare clearance (cf_clearance + User-Agent) or residential EU proxy.',
        );
      }
    } else if (result.success) {
      clobGeoblockBackoffUntil = 0;
    }

    return {
      success: result.success,
      tradeId: trade.id,
      error: result.error,
    };
  }

  // Kalshi real execution (now using the authenticated trading client)
  if (req.market.platform === 'kalshi') {
    try {
      const kalshiClient = getKalshiTradingClient();

      // Convert our normalized side/price to Kalshi format
      // Our system: BUY = Yes, SELL = No (for binary markets)
      const kalshiSide = req.side === 'BUY' ? 'yes' : 'no';
      const kalshiPriceCents = Math.round(req.price * 100);

      const orderResult = await kalshiClient.placeOrder({
        ticker: req.market.externalId,
        side: kalshiSide,
        type: 'limit',
        count: Math.round(finalSize), // Kalshi uses count (number of contracts)
        price: kalshiPriceCents,
      });

      const newStatus = orderResult.success ? 'filled' : 'pending'; // Kalshi may require separate fill confirmation

      await db.update(realTrades)
        .set({
          status: newStatus,
          txHash: orderResult.order_id || undefined,
        })
        .where(eq(realTrades.id, trade.id));

      await logAudit('kalshi_real_order_result', {
        tradeId: trade.id,
        ...orderResult,
      });

      if (orderResult.success) {
        executionManager.recordOrderPosted(
          req.market.externalId,
          req.side,
          req.price,
          finalSize,
        );
      }

      return {
        success: !!orderResult.success,
        tradeId: trade.id,
        error: orderResult.error,
      };
    } catch (kalshiErr: unknown) {
      const errorMessage = kalshiErr instanceof Error ? kalshiErr.message : String(kalshiErr);
      await db.update(realTrades).set({ status: 'rejected' }).where(eq(realTrades.id, trade.id));
      await logAudit('kalshi_real_order_failed', {
        tradeId: trade.id,
        error: errorMessage,
      });
      return { success: false, error: errorMessage || 'Kalshi order failed' };
    }
  }

  return { success: false, error: 'Unsupported platform for real execution' };
}

async function logAudit(action: string, payload: Record<string, unknown>) {
  await db.insert(auditEvents).values({
    actor: 'real-executor',
    action,
    payload,
  }).catch(() => {});
}
