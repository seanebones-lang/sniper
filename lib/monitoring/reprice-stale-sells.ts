/**
 * Cancel and repost stale limit SELL orders so ask-only exits don't sit forever.
 */
import { db, realTrades, auditEvents } from '@/lib/db';
import { eq, and, lt } from 'drizzle-orm';
import {
  getPolymarketPrivateKey,
  cancelPolymarketOrder,
  isValidPolymarketOrderId,
} from '@/lib/clients/polymarket-trading';
import { fetchPolymarketMarketByTokenId, fetchPolymarketOrderBook } from '@/lib/clients/polymarket';
import { repriceStaleSellLimit } from '@/lib/execution/exit-pricing';
import { ensureMarketRecord } from '@/lib/markets';

const REPRICE_AFTER_MS = 15 * 60 * 1000;
const MIN_REPRICE_GAP_MS = 10 * 60 * 1000;
let lastRepriceRunAt = 0;

async function logAudit(action: string, payload: Record<string, unknown>) {
  try {
    await db.insert(auditEvents).values({ actor: 'reprice-sells', action, payload });
  } catch {
    // best effort
  }
}

export async function repriceStalePendingSells(): Promise<number> {
  if (process.env.SNIPER_ENABLE_REAL_EXECUTION !== 'true') return 0;

  const now = Date.now();
  if (now - lastRepriceRunAt < MIN_REPRICE_GAP_MS) return 0;
  lastRepriceRunAt = now;

  const pk = getPolymarketPrivateKey();
  if (!pk) return 0;

  const cutoff = new Date(now - REPRICE_AFTER_MS);
  const stale = await db.query.realTrades.findMany({
    where: and(eq(realTrades.status, 'pending'), eq(realTrades.side, 'SELL'), lt(realTrades.createdAt, cutoff)),
    limit: 10,
  });

  if (stale.length === 0) return 0;

  let repriced = 0;

  for (const trade of stale) {
    if (trade.platform !== 'polymarket') continue;

    const orderId = isValidPolymarketOrderId(trade.txHash) ? trade.txHash! : null;
    if (orderId) {
      await cancelPolymarketOrder(pk, orderId);
    }

    await db.update(realTrades).set({ status: 'cancelled' }).where(eq(realTrades.id, trade.id));

    const book = await fetchPolymarketOrderBook(trade.marketExternalId);
    const priorPrice = parseFloat(trade.price);
    const limitPrice = repriceStaleSellLimit(priorPrice, book, priorPrice);
    const size = Math.floor(parseFloat(trade.size));
    if (size <= 0) continue;

    let market = await fetchPolymarketMarketByTokenId(trade.marketExternalId);
    if (!market) {
      market = {
        id: trade.marketExternalId,
        platform: 'polymarket',
        externalId: trade.marketExternalId,
        question: '',
        status: 'open',
        updatedAt: new Date().toISOString(),
      };
    }

    await ensureMarketRecord(market);
    const { placeRealOrder } = await import('@/lib/execution/real-executor');
    const hasBids = (book?.bids?.length ?? 0) > 0 && (book?.bids?.[0]?.size ?? 0) > 0;

    const result = await placeRealOrder({
      market,
      side: 'SELL',
      price: hasBids ? (book!.bids![0].price) : limitPrice,
      size,
      reason: `[REPRICE] stale limit SELL was ${priorPrice} → ${limitPrice.toFixed(4)}`,
      isExit: true,
      book,
      takeLiquidity: hasBids,
      maxNotionalUsd: size * limitPrice,
    });

    await logAudit('stale_sell_repriced', {
      priorTradeId: trade.id,
      priorPrice,
      newPrice: limitPrice,
      success: result.success,
      newTradeId: result.tradeId,
      error: result.error,
    });

    if (result.success) repriced++;
  }

  if (repriced > 0) {
    console.log(`[RepriceSells] Reposted ${repriced} stale limit SELL(s)`);
  }

  return repriced;
}
