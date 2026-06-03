import { describe, expect, it } from 'vitest';
import { parsePolymarketWSBook, sameAssetIdSet } from '@/lib/ws/polymarket';
import { parseKalshiWSBook } from '@/lib/ws/kalshi';
import { KalshiWSOrderbookState } from '@/lib/ws/kalshi-orderbook-state';

describe('sameAssetIdSet', () => {
  it('matches same ids regardless of order', () => {
    expect(sameAssetIdSet(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameAssetIdSet(['a', 'b'], ['a', 'c'])).toBe(false);
  });
});

describe('parsePolymarketWSBook', () => {
  it('parses full book messages', () => {
    const book = parsePolymarketWSBook(
      {
        type: 'book',
        asset_id: 'token-1',
        bids: [{ price: '0.48', size: '100' }],
        asks: [{ price: '0.52', size: '80' }],
      },
      'token-1',
    );
    expect(book?.mid).toBeCloseTo(0.5);
    expect(book?.spread).toBeCloseTo(0.04);
    expect(book?.bids[0]?.price).toBe(0.48);
  });

  it('parses best_bid_ask messages', () => {
    const book = parsePolymarketWSBook(
      {
        type: 'best_bid_ask',
        asset_id: 'token-2',
        bid: '0.40',
        ask: '0.44',
      },
      'token-2',
    );
    expect(book?.mid).toBeCloseTo(0.42);
  });
});

describe('parseKalshiWSBook', () => {
  it('parses ticker yes bid/ask in dollars', () => {
    const book = parseKalshiWSBook(
      {
        market_ticker: 'KXTEST-YES',
        yes_bid_dollars: '0.45',
        yes_ask_dollars: '0.47',
      },
      'KXTEST-YES',
    );
    expect(book?.mid).toBeCloseTo(0.46);
    expect(book?.platform).toBe('kalshi');
  });

  it('parses ticker envelope messages', () => {
    const book = parseKalshiWSBook(
      {
        type: 'ticker',
        msg: {
          market_ticker: 'KXTEST-YES',
          yes_bid_dollars: '0.40',
          yes_ask_dollars: '0.44',
        },
      },
      'KXTEST-YES',
    );
    expect(book?.mid).toBeCloseTo(0.42);
  });
});

describe('KalshiWSOrderbookState', () => {
  it('builds book from orderbook_snapshot', () => {
    const state = new KalshiWSOrderbookState();
    const book = state.process({
      type: 'orderbook_snapshot',
      msg: {
        market_ticker: 'KXTEST',
        yes_dollars_fp: [['0.45', '100']],
        no_dollars_fp: [['0.50', '80']],
      },
    });
    expect(book?.bids[0]?.price).toBeCloseTo(0.45);
    expect(book?.asks[0]?.price).toBeCloseTo(0.5);
  });
});
