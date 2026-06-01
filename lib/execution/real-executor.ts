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
import type { Market } from '@/lib/types';
import { placePolymarketLimitOrder } from '@/lib/clients/polymarket';

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

  const usdValue = req.price * req.size;

  // 1. Risk engine gate (daily loss, size limits, etc.)
  const risk = riskEngine.checkRisk({
    platform: req.market.platform,
    marketExternalId: req.market.externalId,
    side: req.side,
    price: req.price,
    size: req.size,
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

  // 2. Polymarket execution
  if (req.market.platform === 'polymarket') {
    if (!POLYMARKET_PRIVATE_KEY) {
      const msg = 'POLYMARKET_PRIVATE_KEY not set in environment';
      await db.update(realTrades).set({ status: 'rejected' }).where({ id: trade.id } as any);
      return { success: false, error: msg };
    }

    const result = await placePolymarketLimitOrder({
      privateKey: POLYMARKET_PRIVATE_KEY,
      tokenId: req.market.externalId,
      price: req.price,
      size: req.size,
      side: req.side,
    });

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

  // Kalshi real execution can be wired similarly later
  if (req.market.platform === 'kalshi') {
    await db.update(realTrades).set({ status: 'rejected' }).where({ id: trade.id } as any);
    return { success: false, error: 'Kalshi real execution not yet implemented' };
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
