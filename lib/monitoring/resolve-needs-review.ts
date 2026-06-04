/**
 * Auto-resolve `needs_review` real trades by cancelling stuck CLOB orders and
 * force-submitting a SELL for any remaining on-chain balance.
 */
import { db, realTrades, auditEvents } from '@/lib/db';
import { eq, and, inArray } from 'drizzle-orm';
import {
  getPolymarketPrivateKey,
  cancelPolymarketOrder,
  getPolymarketOpenOrders,
  getPolymarketTokenBalance,
  isValidPolymarketOrderId,
  fetchPolymarketOrder,
} from '@/lib/clients/polymarket-trading';
import { fetchPolymarketMarketByTokenId, fetchPolymarketOrderBook } from '@/lib/clients/polymarket';
import { resolveAskOnlySellLimitPrice } from '@/lib/execution/exit-pricing';
import { recordRealFill } from '@/lib/execution/reconcile-real-trades';
import { ensureMarketRecord } from '@/lib/markets';

const MIN_RESOLVE_GAP_MS = 60_000;
let lastResolveRunAt = 0;
const clearedMarketsThisRun = new Set<string>();

async function logAudit(action: string, payload: Record<string, unknown>) {
  try {
    await db.insert(auditEvents).values({ actor: 'resolve-needs-review', action, payload });
  } catch {
    // best effort
  }
}

async function cancelOpenSellsOnMarket(privateKey: string, marketExternalId: string): Promise<void> {
  const open = await getPolymarketOpenOrders(privateKey);
  for (const o of open) {
    const row = o as Record<string, unknown>;
    const assetId = String(row.asset_id ?? '');
    const side = String(row.side ?? '').toUpperCase();
    if (assetId !== marketExternalId || side !== 'SELL') continue;
    const orderId = String(row.id ?? row.orderID ?? '');
    if (isValidPolymarketOrderId(orderId)) {
      await cancelPolymarketOrder(privateKey, orderId);
    }
  }
}

async function cancelOtherStuckSellRows(
  marketExternalId: string,
  keepTradeId: string,
): Promise<void> {
  const stuck = await db.query.realTrades.findMany({
    where: and(
      eq(realTrades.platform, 'polymarket'),
      eq(realTrades.marketExternalId, marketExternalId),
      eq(realTrades.side, 'SELL'),
      inArray(realTrades.status, ['pending', 'needs_review']),
    ),
    limit: 20,
  });

  for (const row of stuck) {
    if (row.id === keepTradeId) continue;
    await db.update(realTrades).set({ status: 'cancelled' }).where(eq(realTrades.id, row.id));
  }
}

async function submitForceSell(
  marketExternalId: string,
  size: number,
  fallbackPrice: number,
): Promise<{ success: boolean; tradeId?: string; error?: string }> {
  const sellSize = Math.floor(size);
  if (sellSize <= 0) {
    return { success: false, error: 'No shares to sell' };
  }

  let market = await fetchPolymarketMarketByTokenId(marketExternalId);
  if (!market) {
    market = {
      id: marketExternalId,
      platform: 'polymarket',
      externalId: marketExternalId,
      question: '',
      status: 'open',
      updatedAt: new Date().toISOString(),
    };
  }

  const book = await fetchPolymarketOrderBook(marketExternalId);
  const hasBids = (book?.bids?.length ?? 0) > 0 && (book?.bids?.[0]?.size ?? 0) > 0;
  const sellPrice = hasBids
    ? book!.bids![0].price
    : resolveAskOnlySellLimitPrice(book, fallbackPrice);

  await ensureMarketRecord(market);
  const { placeRealOrder } = await import('@/lib/execution/real-executor');
  return placeRealOrder({
    market,
    side: 'SELL',
    price: sellPrice,
    size: sellSize,
    reason: '[NEEDS_REVIEW] auto force exit',
    isExit: true,
    book,
    takeLiquidity: hasBids,
    maxNotionalUsd: sellSize * sellPrice,
  });
}

async function resolvePolymarketNeedsReviewTrade(
  privateKey: string,
  trade: typeof realTrades.$inferSelect,
): Promise<boolean> {
  const marketKey = trade.marketExternalId;
  if (!clearedMarketsThisRun.has(marketKey)) {
    await cancelOpenSellsOnMarket(privateKey, marketKey);
    clearedMarketsThisRun.add(marketKey);
  }
  await cancelOtherStuckSellRows(marketKey, trade.id);

  const orderId = isValidPolymarketOrderId(trade.txHash) ? trade.txHash! : null;
  if (orderId) {
    await cancelPolymarketOrder(privateKey, orderId);
    const recon = await fetchPolymarketOrder(privateKey, orderId);
    if (recon?.status === 'filled' && recon.filledSize > 0) {
      await recordRealFill({
        tradeId: trade.id,
        filledSize: recon.filledSize,
        filledPrice: recon.avgPrice > 0 ? recon.avgPrice : parseFloat(trade.price),
        txHash: orderId,
      });
      await logAudit('needs_review_sell_already_filled', { tradeId: trade.id, orderId });
      return true;
    }
  }

  const onChain = await getPolymarketTokenBalance(privateKey, trade.marketExternalId);
  const expectedSize = parseFloat(trade.size);
  const fillPrice = parseFloat(trade.price);

  if (trade.side === 'SELL') {
    if (onChain != null && onChain <= 0.05) {
      await recordRealFill({
        tradeId: trade.id,
        filledSize: expectedSize,
        filledPrice: fillPrice,
        txHash: orderId ?? undefined,
      });
      await logAudit('needs_review_sell_confirmed_empty_balance', {
        tradeId: trade.id,
        onChain,
      });
      return true;
    }

    await db.update(realTrades).set({ status: 'cancelled' }).where(eq(realTrades.id, trade.id));

    const sellSize = onChain ?? expectedSize;
    const result = await submitForceSell(trade.marketExternalId, sellSize, fillPrice);
    await logAudit('needs_review_force_sell', {
      priorTradeId: trade.id,
      sellSize,
      success: result.success,
      newTradeId: result.tradeId,
      error: result.error,
    });
    return result.success;
  }

  // BUY stuck in needs_review — confirm fill from chain, then force exit.
  if (onChain != null && onChain > 0.05) {
    await recordRealFill({
      tradeId: trade.id,
      filledSize: onChain,
      filledPrice: fillPrice,
      txHash: orderId ?? undefined,
    });
    const result = await submitForceSell(trade.marketExternalId, onChain, fillPrice);
    await logAudit('needs_review_buy_then_force_sell', {
      priorTradeId: trade.id,
      onChain,
      success: result.success,
      newTradeId: result.tradeId,
      error: result.error,
    });
    return result.success;
  }

  await db.update(realTrades).set({ status: 'cancelled' }).where(eq(realTrades.id, trade.id));
  await logAudit('needs_review_buy_cancelled_no_balance', { tradeId: trade.id });
  return true;
}

/** Cancel stuck orders and force-sell any `needs_review` real trades. */
export async function resolveNeedsReviewTrades(): Promise<number> {
  if (process.env.SNIPER_ENABLE_REAL_EXECUTION !== 'true') return 0;

  const now = Date.now();
  if (now - lastResolveRunAt < MIN_RESOLVE_GAP_MS) return 0;
  lastResolveRunAt = now;
  clearedMarketsThisRun.clear();

  const privateKey = getPolymarketPrivateKey();
  if (!privateKey) return 0;

  const stuck = await db.query.realTrades.findMany({
    where: eq(realTrades.status, 'needs_review'),
    limit: 10,
  });
  if (stuck.length === 0) return 0;

  let resolved = 0;
  for (const trade of stuck) {
    try {
      if (trade.platform === 'polymarket') {
        const ok = await resolvePolymarketNeedsReviewTrade(privateKey, trade);
        if (ok) resolved++;
        continue;
      }

      // Kalshi: cancel ambiguous row; human can re-enter if needed.
      await db.update(realTrades).set({ status: 'cancelled' }).where(eq(realTrades.id, trade.id));
      await logAudit('needs_review_kalshi_cancelled', { tradeId: trade.id });
      resolved++;
    } catch (err) {
      await logAudit('needs_review_resolve_error', {
        tradeId: trade.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (resolved > 0) {
    console.log(`[ResolveNeedsReview] Resolved ${resolved}/${stuck.length} needs_review trade(s)`);
  }

  return resolved;
}
