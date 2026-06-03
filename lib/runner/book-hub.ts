/**
 * Persistent WebSocket book hub for the 24/7 runner.
 * Streams Polymarket + Kalshi top-of-book; REST backfills missing/stale only.
 */

import type { OrderBook } from '@/lib/types';
import { fetchPolymarketOrderBook } from '@/lib/clients/polymarket';
import { fetchKalshiOrderBook } from '@/lib/clients/kalshi';
import { PolymarketWSClient, parsePolymarketWSBook, type PolymarketWSMessage } from '@/lib/ws/polymarket';
import { KalshiWSClient, parseKalshiWSBook, type KalshiWSMessage } from '@/lib/ws/kalshi';
import { KalshiWSOrderbookState } from '@/lib/ws/kalshi-orderbook-state';
import { getKalshiCredentialsOptional } from '@/lib/clients/kalshi-auth';
import { bookKey, type BookKey } from '@/lib/runner/book-cache';

type BookSource = 'ws' | 'rest';

interface BookEntry {
  book: OrderBook;
  updatedAt: number;
  source: BookSource;
}

export interface BookHubFetchStats {
  wsHits: number;
  restFetched: number;
  watchlistSize: number;
  polyConnected: boolean;
  kalshiConnected: boolean;
}

const WS_STALE_MS = 60_000;
const REST_STALE_MS = 120_000;
const WS_WARMUP_MS = 800;
/** Polymarket rejects very large subscribe payloads ("INVALID OPERATION"). */
const MAX_POLY_WS_ASSETS = 50;
const MAX_KALSHI_WS_TICKERS = 40;

type HubGlobal = typeof globalThis & {
  __sniperBookHub?: RunnerBookHub;
};

export class RunnerBookHub {
  private books = new Map<BookKey, BookEntry>();
  private polyIds: string[] = [];
  private kalshiTickers: string[] = [];
  private lastPolyWatchKey = '';
  private lastKalshiWatchKey = '';
  private polyClient: PolymarketWSClient | null = null;
  private kalshiClient: KalshiWSClient | null = null;
  private kalshiOrderbookState = new KalshiWSOrderbookState();
  private started = false;
  private lastStats: BookHubFetchStats = {
    wsHits: 0,
    restFetched: 0,
    watchlistSize: 0,
    polyConnected: false,
    kalshiConnected: false,
  };

  start() {
    if (this.started) return;
    this.started = true;

    this.polyClient = new PolymarketWSClient({
      onMessage: (msg: PolymarketWSMessage) => this.onPolymarketMessage(msg),
      onOpen: () => {
        this.lastStats.polyConnected = true;
      },
      onClose: () => {
        this.lastStats.polyConnected = false;
      },
    });

    this.kalshiClient = new KalshiWSClient({
      channels: ['orderbook_delta'],
      credentials: getKalshiCredentialsOptional(),
      onMessage: (msg: KalshiWSMessage) => this.onKalshiMessage(msg),
      onOpen: () => {
        this.lastStats.kalshiConnected = true;
      },
      onClose: () => {
        this.lastStats.kalshiConnected = false;
      },
    });

    if (this.polyIds.length > 0) {
      this.polyClient.connect(this.polyIds);
    }
    if (this.kalshiTickers.length > 0) {
      this.kalshiClient.connect(this.kalshiTickers);
    }

    console.log('[BookHub] Started (WS-first book feed for runner)');
  }

  stop() {
    this.started = false;
    this.polyClient?.disconnect();
    this.kalshiClient?.disconnect();
    this.polyClient = null;
    this.kalshiClient = null;
    this.lastStats.polyConnected = false;
    this.lastStats.kalshiConnected = false;
    console.log('[BookHub] Stopped');
  }

  getLastStats(): BookHubFetchStats {
    return { ...this.lastStats };
  }

  getBook(platform: string, externalId: string): OrderBook | null {
    return this.books.get(bookKey(platform, externalId))?.book ?? null;
  }

  private setBook(platform: string, externalId: string, book: OrderBook, source: BookSource) {
    this.books.set(bookKey(platform, externalId), {
      book: { ...book, timestamp: new Date().toISOString() },
      updatedAt: Date.now(),
      source,
    });
  }

  private onPolymarketMessage(msg: PolymarketWSMessage) {
    const assetId = 'asset_id' in msg ? msg.asset_id : undefined;
    if (!assetId) return;
    const book = parsePolymarketWSBook(msg, assetId);
    if (book) {
      this.setBook('polymarket', assetId, book, 'ws');
    }
  }

  private onKalshiMessage(msg: KalshiWSMessage) {
    const type = String(msg.type ?? '');
    if (type === 'orderbook_snapshot' || type === 'orderbook_delta') {
      const book = this.kalshiOrderbookState.process(msg);
      if (book) {
        this.setBook('kalshi', book.marketExternalId, book, 'ws');
      }
      return;
    }

    const ticker = String(
      (msg.msg as KalshiWSMessage | undefined)?.market_ticker ??
        msg.market_ticker ??
        msg.ticker ??
        '',
    );
    if (!ticker) return;
    const book = parseKalshiWSBook(msg, ticker);
    if (book) {
      this.setBook('kalshi', ticker, book, 'ws');
    }
  }

  private syncWatchlist(markets: Array<{ platform: string; externalId: string }>) {
    const polySet = new Set<string>();
    const kalshiSet = new Set<string>();

    for (const m of markets) {
      if (m.platform === 'polymarket') polySet.add(m.externalId);
      if (m.platform === 'kalshi') kalshiSet.add(m.externalId);
    }

    this.polyIds = [...polySet].slice(0, MAX_POLY_WS_ASSETS);
    this.kalshiTickers = [...kalshiSet].slice(0, MAX_KALSHI_WS_TICKERS);
    this.lastStats.watchlistSize = polySet.size + kalshiSet.size;

    if (polySet.size > MAX_POLY_WS_ASSETS) {
      console.log(
        `[BookHub] Polymarket WS cap: streaming ${MAX_POLY_WS_ASSETS}/${polySet.size} (rest via REST)`,
      );
    }

    if (!this.started || !this.polyClient || !this.kalshiClient) return;

    const polyWatchKey = [...this.polyIds].sort().join('\0');
    const polyWatchUnchanged = polyWatchKey === this.lastPolyWatchKey;

    if (this.polyIds.length === 0) {
      this.lastPolyWatchKey = '';
      this.polyClient.disconnect();
      this.polyClient = new PolymarketWSClient({
        onMessage: (msg) => this.onPolymarketMessage(msg),
        onOpen: () => {
          this.lastStats.polyConnected = true;
        },
        onClose: () => {
          this.lastStats.polyConnected = false;
        },
      });
    } else if (polyWatchUnchanged && this.polyClient.isConnecting()) {
      // Same watchlist; socket already up or connecting — do not tear down.
    } else if (polyWatchUnchanged && this.polyClient.isOpen()) {
      this.lastStats.polyConnected = true;
    } else if (polyWatchUnchanged) {
      this.polyClient.connect(this.polyIds);
    } else if (this.polyClient.isOpen()) {
      this.lastPolyWatchKey = polyWatchKey;
      this.polyClient.updateSubscriptions(this.polyIds);
      this.lastStats.polyConnected = true;
    } else {
      this.lastPolyWatchKey = polyWatchKey;
      this.polyClient.connect(this.polyIds);
    }

    const kalshiWatchKey = [...this.kalshiTickers].sort().join('\0');
    const kalshiWatchUnchanged = kalshiWatchKey === this.lastKalshiWatchKey;

    if (this.kalshiTickers.length === 0) {
      this.lastKalshiWatchKey = '';
      this.kalshiClient.disconnect();
      this.kalshiClient = new KalshiWSClient({
        channels: ['orderbook_delta'],
        credentials: getKalshiCredentialsOptional(),
        onMessage: (msg) => this.onKalshiMessage(msg),
        onOpen: () => {
          this.lastStats.kalshiConnected = true;
        },
        onClose: () => {
          this.lastStats.kalshiConnected = false;
        },
      });
      this.kalshiOrderbookState.clear();
    } else if (kalshiWatchUnchanged && this.lastStats.kalshiConnected) {
      // unchanged watchlist — keep existing socket
    } else {
      this.lastKalshiWatchKey = kalshiWatchKey;
      if (this.lastStats.kalshiConnected) {
        this.kalshiClient.updateSubscriptions(this.kalshiTickers);
      } else {
        this.kalshiClient.connect(this.kalshiTickers);
      }
    }
  }

  private isFresh(platform: string, externalId: string): boolean {
    const entry = this.books.get(bookKey(platform, externalId));
    if (!entry) return false;
    const maxAge = entry.source === 'ws' ? WS_STALE_MS : REST_STALE_MS;
    return Date.now() - entry.updatedAt < maxAge;
  }

  /** WS often sends ask-only or bid-only snapshots; REST has the full book. */
  private isOneSided(platform: string, externalId: string): boolean {
    const book = this.books.get(bookKey(platform, externalId))?.book;
    if (!book) return false;
    const hasBid = (book.bids?.length ?? 0) > 0;
    const hasAsk = (book.asks?.length ?? 0) > 0;
    return hasBid !== hasAsk;
  }

  private waitMs(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Ensure books exist for markets; REST only for missing or stale entries. */
  async ensureBooks(
    markets: Array<{ platform: string; externalId: string }>,
    concurrency = 16,
  ): Promise<BookHubFetchStats> {
    const unique = [...new Map(markets.map((m) => [bookKey(m.platform, m.externalId), m])).values()];
    this.syncWatchlist(unique);

    if (!this.started) {
      this.start();
    }

    let wsHits = 0;
    const needRest: typeof unique = [];

    for (const m of unique) {
      const fresh = this.isFresh(m.platform, m.externalId);
      const oneSided = fresh && this.isOneSided(m.platform, m.externalId);
      if (fresh && !oneSided) {
        wsHits++;
      } else {
        needRest.push(m);
      }
    }

    const skipWarmup = needRest.length === 0 || wsHits >= unique.length * 0.9;
    if (!skipWarmup && (this.polyIds.length > 0 || this.kalshiTickers.length > 0)) {
      await this.waitMs(WS_WARMUP_MS);
    }

    let restFetched = 0;
    for (let i = 0; i < needRest.length; i += concurrency) {
      const batch = needRest.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async (m) => {
          try {
            const book =
              m.platform === 'polymarket'
                ? await fetchPolymarketOrderBook(m.externalId)
                : await fetchKalshiOrderBook(m.externalId);
            this.setBook(m.platform, m.externalId, book, 'rest');
            restFetched++;
          } catch {
            // Hub has no book for this key; CycleBookCache will see null
          }
        }),
      );
    }

    this.lastStats = {
      wsHits,
      restFetched,
      watchlistSize: unique.length,
      polyConnected: this.lastStats.polyConnected,
      kalshiConnected: this.lastStats.kalshiConnected,
    };

    if (restFetched > 0) {
      console.log(
        `[BookHub] Books: ${wsHits} WS, ${restFetched} REST backfill (${unique.length} markets)`,
      );
    }

    return this.lastStats;
  }
}

export function getRunnerBookHub(): RunnerBookHub {
  const g = globalThis as HubGlobal;
  if (!g.__sniperBookHub) {
    g.__sniperBookHub = new RunnerBookHub();
  }
  return g.__sniperBookHub;
}
