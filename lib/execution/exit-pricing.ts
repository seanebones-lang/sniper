import type { OrderBook } from '@/lib/types';

/** Limit price for a SELL when the book is ask-only (join best ask). */
export function resolveAskOnlySellLimitPrice(
  book: OrderBook | null | undefined,
  fallbackPrice: number,
): number {
  const bestAsk = book?.asks?.[0]?.price;
  const bestBid = book?.bids?.[0]?.price;
  if (bestBid != null && bestBid > 0) return bestBid;
  if (bestAsk != null && bestAsk > 0) return bestAsk;
  return Math.max(0.001, Math.min(0.99, fallbackPrice * 0.95));
}

/** When repricing a stale limit, walk down slightly if unchanged from prior quote. */
export function repriceStaleSellLimit(
  currentOrderPrice: number,
  book: OrderBook | null | undefined,
  fallbackPrice: number,
): number {
  const target = resolveAskOnlySellLimitPrice(book, fallbackPrice);
  if (Math.abs(target - currentOrderPrice) < 0.0005) {
    return Math.max(0.001, Math.min(0.99, currentOrderPrice * 0.98));
  }
  return target;
}
