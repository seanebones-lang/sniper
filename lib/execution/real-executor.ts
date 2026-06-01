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
import { riskEngine } from '@/lib/risk/engine';
import { portfolioRiskManager } from '@/lib/risk/portfolio-manager';
import type { Market } from '@/lib/types';
import { placePolymarketLimitOrder } from '@/lib/clients/polymarket';
import { getKalshiTradingClient } from '@/lib/clients/kalshi-trading';
import { executionManager } from './execution-manager';

const REAL_ENABLED = process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true';
const POLYMARKET_PRIVATE_KEY = process.env.POLYMARKET_PRIVATE_KEY;

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
  if (!REAL_ENABLED) {
    return { success: false, error: 'Real execution disabled (SNIPER_ENABLE_REAL_EXECUTION != true)' };
  }

  // === ADVANCED PORTFOLIO RISK MANAGEMENT ===
  const safeSizing = await portfolioRiskManager.calculateSafeSize({
    platform: req.market.platform,
    marketExternalId: req.market.externalId,
    side: req.side,
    edge: 0.03,                    // placeholder - in real system this would come from the strategy
    confidence: 0.7,
    category: 'crypto',            // TODO: proper market categorization
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
    await db.update(realTrades).set({ status: 'cancelled' }).where({ id: trade.id } as any);
    return { success: false, error: decision.reason };
  }

  // 2. Polymarket execution
  if (req.market.platform === 'polymarket') {
    if (!POLYMARKET_PRIVATE_KEY) {
      const msg = 'POLYMARKET_PRIVATE_KEY not set in environment';
      await db.update(realTrades).set({ status: 'rejected' }).where({ id: trade.id } as any);
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
        true
      );
    }

    const newStatus = result.success ? 'filled' : 'rejected';

    await db.update(realTrades)
      .set({ 
        status: newStatus,
        txHash: result.orderId || undefined,
      })
      .where({ id: trade.id } as any);

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
        .where({ id: trade.id } as any);

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
          true
        );
      }

      return {
        success: !!orderResult.success,
        tradeId: trade.id,
        error: orderResult.error,
      };
    } catch (kalshiErr: any) {
      await db.update(realTrades).set({ status: 'rejected' }).where({ id: trade.id } as any);
      await logAudit('kalshi_real_order_failed', {
        tradeId: trade.id,
        error: kalshiErr?.message || String(kalshiErr),
      });
      return { success: false, error: kalshiErr?.message || 'Kalshi order failed' };
    }
  }

  return { success: false, error: 'Unsupported platform for real execution' };
}

async function logAudit(action: string, payload: any) {
  await db.insert(auditEvents).values({
    actor: 'real-executor',
    action,
    payload,
  }).catch(() => {});
}
