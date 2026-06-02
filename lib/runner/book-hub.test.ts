import { describe, expect, it } from 'vitest';
import { parsePolymarketWSBook } from '@/lib/ws/polymarket';
import { parseKalshiWSBook } from '@/lib/ws/kalshi';

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
});
