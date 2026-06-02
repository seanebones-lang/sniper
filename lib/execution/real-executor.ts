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

import { db, realTrades, positions, auditEvents } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { riskEngine } from '@/lib/risk/engine';
import { portfolioRiskManager } from '@/lib/risk/portfolio-manager';
import type { Market } from '@/lib/types';
import { placePolymarketLimitOrder } from '@/lib/clients/polymarket';
import { getKalshiTradingClient } from '@/lib/clients/kalshi-trading';
import { executionManager } from './execution-manager';
import { categorizeMarket } from '@/lib/risk/categorizer';
import {
  loadKillSwitchState,
  persistKillSwitchDisabled,
  persistKillSwitchEnabled,
} from '@/lib/monitoring/system-state';

const REAL_ENABLED = process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true';
const POLYMARKET_PRIVATE_KEY = process.env.POLYMARKET_PRIVATE_KEY;

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

export interface RealOrderRequest {
  market: Market;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  reason: string;
}

/**
 * Place a real order.
 * This is the actual execution path — only called when every gate is satisfied.
 */
export async function placeRealOrder(req: RealOrderRequest): Promise<{ success: boolean; tradeId?: string; error?: string }> {
  if (!(await isRealExecutionAllowed())) {
    return { success: false, error: 'Real execution disabled (kill-switch or env flag)' };
  }

  // === ADVANCED PORTFOLIO RISK MANAGEMENT ===
  const safeSizing = await portfolioRiskManager.calculateSafeSize({
    platform: req.market.platform,
    marketExternalId: req.market.externalId,
    side: req.side,
    edge: 0.03,                    // placeholder - in real system this would come from the strategy
    confidence: 0.7,
    category: categorizeMarket(req.market.question || '', req.market.platform, req.market.externalId).category,
    currentPrice: req.price,
  });

  if (safeSizing.allowedSize <= 5) {
    await logAudit('real_order_blocked_portfolio_risk', { 
      ...req, 
      reason: safeSizing.reason,
      suggestedSize: safeSizing.allowedSize 
    });
    return { success: false, error: `Portfolio risk rejected: ${safeSizing.reason}` };
  }

  // Use the risk-managed size instead of the strategy's requested size
  const finalSize = Math.min(req.size, safeSizing.allowedSize);
  const usdValue = req.price * finalSize;

  // 1. Legacy risk engine gate (still useful as second layer)
  const risk = riskEngine.checkRisk({
    platform: req.market.platform,
    marketExternalId: req.market.externalId,
    side: req.side,
    price: req.price,
    size: finalSize,
    usdValue,
  });

  if (!risk.allowed) {
    await logAudit('real_order_blocked_risk', { ...req, reason: risk.reason });
    return { success: false, error: risk.reason };
  }

  // Record the intent first (audit trail)
  const [trade] = await db.insert(realTrades).values({
    platform: req.market.platform,
    marketExternalId: req.market.externalId,
    side: req.side,
    price: req.price.toString(),
    size: req.size.toString(),
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
  const decision = executionManager.decideExecution(
    { action: req.side, price: req.price, size: finalSize, reason: req.reason },
    null, // book would come from live data
    {
      regime: 'normal', // should come from recent features
      recentImbalance: 0.1,
      timeSinceSignal: 12,
      isRealMoney: true,
      openOrders: executionManager.getOpenOrdersForMarket(req.market.externalId),
    }
  );

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
    if (!POLYMARKET_PRIVATE_KEY) {
      const msg = 'POLYMARKET_PRIVATE_KEY not set in environment';
      await db.update(realTrades).set({ status: 'rejected' }).where(eq(realTrades.id, trade.id));
      return { success: false, error: msg };
    }

    const execPrice = decision.type === 'POST_PASSIVE' || decision.type === 'TAKE_AGGRESSIVE' 
      ? decision.price 
      : req.price;

    const result = await placePolymarketLimitOrder({
      privateKey: POLYMARKET_PRIVATE_KEY,
      tokenId: req.market.externalId,
      price: Math.max(0.01, Math.min(0.99, execPrice)),
      size: finalSize,
      side: req.side,
    });

    if (result.success) {
      executionManager.recordOrderPosted(
        req.market.externalId,
        req.side,
        execPrice,
        finalSize,
      );

      // Basic position tracking for real trades (advances audit-real-2)
      await recordRealFillForPosition({
        platform: req.market.platform,
        marketExternalId: req.market.externalId,
        side: req.side,
        size: finalSize,
        price: execPrice,
      });
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

    await logAudit('real_order_result', { tradeId: trade.id, ...result });

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

/**
 * Basic helper to update positions table after a successful real fill.
 * This is a pragmatic step toward better real trade position tracking.
 */
async function recordRealFillForPosition(params: {
  platform: string;
  marketExternalId: string;
  side: 'BUY' | 'SELL';
  size: number;
  price: number;
}) {
  try {
    // Ensure the market exists in our DB (important for real trades) — use the minimal form to avoid casts
    const { ensureMarket } = await import('@/lib/markets');

    const marketId = await ensureMarket({
      platform: params.platform as 'polymarket' | 'kalshi',
      externalId: params.marketExternalId,
      question: 'Real Execution Market',
      status: 'open',
    });

    // Find or create the internal market row (we just ensured it)
    const market = await db.query.markets.findFirst({
      where: (m, { eq }) => eq(m.id, marketId),
    });

    if (!market) return;

    const signedSize = params.side === 'BUY' ? params.size : -params.size;

    const existing = await db.query.positions.findFirst({
      where: (p, { and, eq }) => and(
        eq(p.platform, params.platform),
        eq(p.marketId, market.id)
      ),
    });

    if (existing) {
      const newSize = parseFloat(existing.sizeShares) + signedSize;
      // Very simplified average price update
      const totalCost = parseFloat(existing.sizeShares) * parseFloat(existing.avgPrice) + signedSize * params.price;
      const newAvg = newSize !== 0 ? totalCost / newSize : params.price;

      await db.update(positions).set({
        sizeShares: newSize.toString(),
        avgPrice: newAvg.toString(),
        updatedAt: new Date(),
      }).where(eq(positions.id, existing.id));
    } else {
      await db.insert(positions).values({
        platform: params.platform,
        marketId: market.id,
        side: params.side,
        sizeShares: signedSize.toString(),
        avgPrice: params.price.toString(),
      });
    }
  } catch (err) {
    // Best effort — don't fail the whole order because of position tracking
    console.warn('[Real Executor] Position tracking failed (non-fatal)', err);
  }
}

async function logAudit(action: string, payload: Record<string, unknown>) {
  await db.insert(auditEvents).values({
    actor: 'real-executor',
    action,
    payload,
  }).catch(() => {});
}
