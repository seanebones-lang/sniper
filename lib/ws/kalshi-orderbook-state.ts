/**
 * Maintains per-ticker Kalshi orderbook from WS snapshot + delta messages.
 */

import type { OrderBook, OrderBookLevel } from '@/lib/types';
import { normalizeOrderBookLevels } from '@/lib/orderbook';
import type { KalshiWSMessage } from '@/lib/ws/kalshi';

type LevelMap = Map<string, number>;

function fpLevelsToMaps(
  yesFp?: Array<[string, string]>,
  noFp?: Array<[string, string]>,
): { yes: LevelMap; no: LevelMap } {
  const yes = new Map<string, number>();
  const no = new Map<string, number>();
  for (const [price, size] of yesFp ?? []) {
    const s = parseFloat(size);
    if (s > 0) yes.set(price, s);
  }
  for (const [price, size] of noFp ?? []) {
    const s = parseFloat(size);
    if (s > 0) no.set(price, s);
  }
  return { yes, no };
}

function mapsToOrderBook(ticker: string, yes: LevelMap, no: LevelMap): OrderBook | null {
  const yesBids: OrderBookLevel[] = [...yes.entries()]
    .map(([price, size]) => ({ price: parseFloat(price), size }))
    .filter((l) => l.price > 0 && l.size > 0);

  const yesAsks: OrderBookLevel[] = [...no.entries()]
    .map(([noPrice, size]) => ({
      price: Math.max(0.01, Math.min(0.99, 1 - parseFloat(noPrice))),
      size,
    }))
    .filter((l) => l.price > 0 && l.size > 0);

  if (!yesBids.length && !yesAsks.length) return null;

  const { bids, asks, mid, spread } = normalizeOrderBookLevels(
    yesBids.sort((a, b) => b.price - a.price),
    yesAsks.sort((a, b) => a.price - b.price),
  );

  return {
    platform: 'kalshi',
    marketExternalId: ticker,
    bids,
    asks,
    mid,
    spread,
    timestamp: new Date().toISOString(),
  };
}

export class KalshiWSOrderbookState {
  private books = new Map<string, { yes: LevelMap; no: LevelMap }>();

  process(data: KalshiWSMessage): OrderBook | null {
    const type = String(data.type ?? '');
    const msg = (data.msg ?? data) as KalshiWSMessage;
    const ticker = String(msg.market_ticker ?? msg.ticker ?? '');
    if (!ticker) return null;

    if (type === 'orderbook_snapshot') {
      const yesFp = msg.yes_dollars_fp as Array<[string, string]> | undefined;
      const noFp = msg.no_dollars_fp as Array<[string, string]> | undefined;
      const maps = fpLevelsToMaps(yesFp, noFp);
      this.books.set(ticker, maps);
      return mapsToOrderBook(ticker, maps.yes, maps.no);
    }

    if (type === 'orderbook_delta') {
      let maps = this.books.get(ticker);
      if (!maps) {
        maps = { yes: new Map(), no: new Map() };
        this.books.set(ticker, maps);
      }
      const side = String(msg.side ?? '');
      const price = String(msg.price_dollars ?? '');
      const delta = parseFloat(String(msg.delta_fp ?? '0'));
      if (!price || Number.isNaN(delta)) return null;

      const bookSide = side === 'no' ? maps.no : maps.yes;
      const next = (bookSide.get(price) ?? 0) + delta;
      if (next <= 0) bookSide.delete(price);
      else bookSide.set(price, next);

      return mapsToOrderBook(ticker, maps.yes, maps.no);
    }

    return null;
  }

  clear() {
    this.books.clear();
  }
}
