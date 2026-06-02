import { fetchPolymarketOrderBook } from '@/lib/clients/polymarket';
import { fetchKalshiOrderBook } from '@/lib/clients/kalshi';
import type { OrderBook } from '@/lib/types';
import type { MarkPriceMap } from '@/lib/paper/mark-to-market';

export type BookKey = `${string}:${string}`;

export function bookKey(platform: string, externalId: string): BookKey {
  return `${platform}:${externalId}`;
}

export class CycleBookCache {
  private books = new Map<BookKey, OrderBook | null>();
  private markPrices = new Map<BookKey, number | null>();

  async fetchBooks(
    markets: Array<{ platform: string; externalId: string }>,
    concurrency = 8,
  ): Promise<number> {
    const unique = [...new Map(markets.map((m) => [bookKey(m.platform, m.externalId), m])).values()];
    let fetched = 0;

    for (let i = 0; i < unique.length; i += concurrency) {
      const batch = unique.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async (m) => {
          const key = bookKey(m.platform, m.externalId);
          if (this.books.has(key)) return;
          try {
            const book =
              m.platform === 'polymarket'
                ? await fetchPolymarketOrderBook(m.externalId)
                : await fetchKalshiOrderBook(m.externalId);
            this.books.set(key, book);
            const mark = book.mid ?? book.bids[0]?.price ?? book.asks[0]?.price ?? null;
            this.markPrices.set(key, mark);
            fetched++;
          } catch {
            this.books.set(key, null);
            this.markPrices.set(key, null);
          }
        }),
      );
    }

    return fetched;
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
