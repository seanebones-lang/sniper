import type { OrderBook } from '@/lib/types';

/**
 * Mark for exit PnL — prefer mid over a lone penny bid that would fake a -99% loss
 * and trigger a stop into illiquid garbage.
 */
export function resolveExitMarkPrice(
  book: OrderBook | null | undefined,
  fallback?: number,
): number | undefined {
  const bid = book?.bids?.[0]?.price;
  const ask = book?.asks?.[0]?.price;
  const mid =
    book?.mid ??
    (bid != null && ask != null && bid > 0 && ask > 0 ? (bid + ask) / 2 : undefined);

  if (mid != null && mid > 0) {
    if (bid != null && bid > 0 && bid < mid * 0.35) {
      return mid;
    }
    return mid;
  }

  if (bid != null && bid > 0) return bid;
  if (ask != null && ask > 0) return ask;
  return fallback;
}
