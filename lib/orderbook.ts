import type { OrderBookLevel } from './types';

/** Bids highest-first, asks lowest-first — required for correct mid/spread. */
export function normalizeOrderBookLevels(bids: OrderBookLevel[], asks: OrderBookLevel[]) {
  const sortedBids = [...bids].sort((a, b) => b.price - a.price);
  const sortedAsks = [...asks].sort((a, b) => a.price - b.price);
  const bestBid = sortedBids[0];
  const bestAsk = sortedAsks[0];

  const mid =
    bestBid && bestAsk
      ? (bestBid.price + bestAsk.price) / 2
      : bestBid?.price ?? bestAsk?.price;

  const spread =
    bestBid && bestAsk ? bestAsk.price - bestBid.price : undefined;

  return { bids: sortedBids, asks: sortedAsks, mid, spread };
}
