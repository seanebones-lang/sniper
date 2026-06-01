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
import { fetchPolymarketOrderBook } from '@/lib/clients/polymarket'; // we will extend later

const REAL_ENABLED = process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true';

export interface RealOrderRequest {
  market: Market;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  reason: string;
}

export async function placeRealOrder(req: RealOrderRequest): Promise<{ success: boolean; tradeId?: string; error?: string }> {
  if (!REAL_ENABLED) {
    return { success: false, error: 'Real execution is disabled. Set SNIPER_ENABLE_REAL_EXECUTION=true to enable.' };
  }

  const usdValue = req.price * req.size;

  // Risk gate
  const risk = riskEngine.checkRisk({
    platform: req.market.platform,
    marketExternalId: req.market.externalId,
    side: req.side,
    price: req.price,
    size: req.size,
    usdValue,
  });

  if (!risk.allowed) {
    await logAudit('real_order_blocked_by_risk', { ...req, reason: risk.reason });
    return { success: false, error: risk.reason };
  }

  // For Phase 4 we log intent but do NOT yet place real orders on chain/exchange
  // This prevents accidental loss while we harden further.
  // Next step (fine tune) will wire actual SDK calls.

  const [trade] = await db.insert(realTrades).values({
    platform: req.market.platform,
    marketExternalId: req.market.externalId,
    side: req.side,
    price: req.price.toString(),
    size: req.size.toString(),
    fee: (usdValue * 0.0005).toString(),
    status: 'pending',
  }).returning();

  await logAudit('real_order_intent', {
    tradeId: trade.id,
    ...req,
    usdValue,
  });

  console.warn('[REAL EXECUTOR] Intent logged but actual order placement still disabled in this build for safety.');

  return {
    success: true,
    tradeId: trade.id,
  };
}

async function logAudit(action: string, payload: any) {
  await db.insert(auditEvents).values({
    actor: 'real-executor',
    action,
    payload,
  }).catch(() => {});
}
