import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchBtcUsdtCloses, clearBtcCandleCache, getBtcCandleSource } from './ccxt-binance';

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
function fail(status = 451) {
  return { ok: false, status, json: async () => ({}) } as unknown as Response;
}

// 10 rows is above the MIN_CLOSES=8 floor.
const binanceKlines = Array.from({ length: 10 }, (_, i) => [
  i,
  '0',
  '0',
  '0',
  String(100 + i), // close at index 4
  '0',
]);
// Coinbase is newest→oldest: [time, low, high, open, close, volume].
const coinbaseCandles = Array.from({ length: 10 }, (_, i) => [i, 0, 0, 0, 200 + i, 0]).reverse();
const krakenOhlc = {
  error: [],
  result: {
    XXBTZUSD: Array.from({ length: 10 }, (_, i) => [i, '0', '0', '0', String(300 + i), '0', '0', 0]),
    last: 123,
  },
};

describe('fetchBtcUsdtCloses multi-venue fallback', () => {
  beforeEach(() => clearBtcCandleCache());
  afterEach(() => vi.unstubAllGlobals());

  it('uses Binance when reachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('binance')) return ok(binanceKlines);
      return fail();
    }));

    const closes = await fetchBtcUsdtCloses(30, true);
    expect(closes).not.toBeNull();
    expect(closes![closes!.length - 1]).toBe(109);
    expect(getBtcCandleSource()).toBe('binance-vision');
  });

  it('falls back to Coinbase when Binance is geoblocked (451)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('binance')) return fail(451);
      if (url.includes('coinbase')) return ok(coinbaseCandles);
      return fail();
    }));

    const closes = await fetchBtcUsdtCloses(30, true);
    expect(closes).not.toBeNull();
    // Normalized oldest→newest, so the final close is the largest.
    expect(closes![closes!.length - 1]).toBe(209);
    expect(getBtcCandleSource()).toBe('coinbase');
  });

  it('falls back to Kraken when Binance and Coinbase both fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('kraken')) return ok(krakenOhlc);
      return fail();
    }));

    const closes = await fetchBtcUsdtCloses(30, true);
    expect(closes).not.toBeNull();
    expect(closes![closes!.length - 1]).toBe(309);
    expect(getBtcCandleSource()).toBe('kraken');
  });

  it('serves the last good closes when every venue fails on a later call', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('binance')) return ok(binanceKlines);
      return fail();
    }));
    const first = await fetchBtcUsdtCloses(30, true);
    expect(first).not.toBeNull();

    vi.stubGlobal('fetch', vi.fn(async () => fail(500)));
    const second = await fetchBtcUsdtCloses(30, true);
    expect(second).toEqual(first); // stale-but-usable beats killing the strategy
  });

  it('returns null when every venue fails and there is no cache', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => fail(451)));
    const closes = await fetchBtcUsdtCloses(30, true);
    expect(closes).toBeNull();
  });
});
