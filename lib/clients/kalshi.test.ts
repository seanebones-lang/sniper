import { describe, expect, it } from 'vitest';
import { parseKalshiOrderBookPayload } from './kalshi';

describe('parseKalshiOrderBookPayload', () => {
  it('parses orderbook_fp yes/no dollars into YES bids and asks', () => {
    const { bids, asks } = parseKalshiOrderBookPayload({
      orderbook_fp: {
        yes_dollars: [['0.0700', '551.00'], ['0.0600', '15.00']],
        no_dollars: [['0.3000', '43.00'], ['0.2100', '1.00']],
      },
    });

    expect(bids[0]?.price).toBeCloseTo(0.07, 4);
    expect(asks[0]?.price).toBeCloseTo(0.7, 4); // 1 - 0.30
    expect(bids.length).toBeGreaterThan(0);
    expect(asks.length).toBeGreaterThan(0);
  });

  it('falls back to legacy cent-based orderbook', () => {
    const { bids, asks } = parseKalshiOrderBookPayload({
      orderbook: {
        yes: {
          bids: [[45, 10]],
          asks: [[55, 8]],
        },
      },
    });

    expect(bids[0]?.price).toBeCloseTo(0.45, 4);
    expect(asks[0]?.price).toBeCloseTo(0.55, 4);
  });
});
