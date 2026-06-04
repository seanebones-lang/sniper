import type { OrderBook } from '@/lib/types';
import type { MarkPriceMap } from '@/lib/paper/mark-to-market';
import { getRunnerBookHub } from '@/lib/runner/book-hub';
import { runPool } from '@/lib/runner/parallel-pool';

export type BookKey = `${string}:${string}`;

export function bookKey(platform: string, externalId: string): BookKey {
  return `${platform}:${externalId}`;
}

export class CycleBookCache {
  private books = new Map<BookKey, OrderBook | null>();
  private markPrices = new Map<BookKey, number | null>();
  lastHubStats: { wsHits: number; restFetched: number; watchlistSize: number } | null = null;

  async fetchBooks(
    markets: Array<{ platform: string; externalId: string }>,
    concurrency = 16,
  ): Promise<number> {
    const hub = getRunnerBookHub();
    const stats = await hub.ensureBooks(markets, concurrency);
    this.lastHubStats = stats;

    const unique = [...new Map(markets.map((m) => [bookKey(m.platform, m.externalId), m])).values()];
    for (const m of unique) {
      const key = bookKey(m.platform, m.externalId);
      const book = hub.getBook(m.platform, m.externalId);
      this.books.set(key, book);
      const mark = book?.mid ?? book?.bids[0]?.price ?? book?.asks[0]?.price ?? null;
      this.markPrices.set(key, mark);
    }

    // Hub watchlist may not have WS snapshots yet — direct REST backfill (no WS code changes).
    const restBackfill = unique.filter((m) => {
      if (m.platform !== 'polymarket') return false;
      const b = this.books.get(bookKey(m.platform, m.externalId));
      return !b?.bids?.length && !b?.asks?.length;
    });
    if (restBackfill.length > 0) {
      const { fetchPolymarketOrderBook } = await import('@/lib/clients/polymarket');
      await runPool(restBackfill, Math.min(12, concurrency), async (m) => {
        try {
          const book = await fetchPolymarketOrderBook(m.externalId);
          const key = bookKey(m.platform, m.externalId);
          this.books.set(key, book);
          const mark = book.mid ?? book.bids[0]?.price ?? book.asks[0]?.price ?? null;
          this.markPrices.set(key, mark);
        } catch {
          // keep hub/null entry
        }
      });
    }

    return stats.restFetched;
  }

  getBook(platform: string, externalId: string): OrderBook | null {
    return this.books.get(bookKey(platform, externalId)) ?? null;
  }

  getMarkPrice(platform: string, externalId: string): number | null {
    return this.markPrices.get(bookKey(platform, externalId)) ?? null;
  }

  toMarkPriceMap(): MarkPriceMap {
    const map: MarkPriceMap = new Map();
    for (const [key, price] of this.markPrices) {
      if (price != null && price > 0) map.set(key, price);
    }
    return map;
  }
}
