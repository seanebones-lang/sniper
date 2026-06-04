import { describe, expect, it } from 'vitest';
import { LiveQuickFlip, maxQuickFlipEntryPrice } from './live-quick-flip';
import { resolveStrategyConfig, resolveStrategyConfigForType } from './run-profile';
import type { Market, OrderBook } from '../types';

function market(question: string, endHours = 2, volume = 10_000): Market {
  return {
    id: 'm1',
    platform: 'polymarket',
    externalId: 'tok-1',
    question,
    status: 'open',
    volume,
    liquidity: volume / 2,
    updatedAt: new Date().toISOString(),
    endDate: new Date(Date.now() + endHours * 3600 * 1000).toISOString(),
  };
}

function book(ask: number, bid?: number, askSize = 100, bidSize = 50): OrderBook {
  return {
    platform: 'polymarket',
    marketExternalId: 'tok-1',
    asks: [{ price: ask, size: askSize }],
    bids: bid != null ? [{ price: bid, size: bidSize }] : [],
    mid: bid != null ? (ask + bid) / 2 : ask,
    spread: bid != null ? ask - bid : 0.02,
    timestamp: new Date().toISOString(),
  };
}

const config = resolveStrategyConfig({
  maxSizeUsd: 1,
  targetProfitPct: 150,
  cooldownSeconds: 15,
  tradingGoal: 'quick-flip',
  tradingStyle: 'aggressive',
  targetProfitMultiple: 2.5,
  liveMarketsOnly: true,
});

describe('LiveQuickFlip', () => {
  it('enters cheap asks even when ask-side dominates the book', () => {
    const signal = LiveQuickFlip.evaluate(
      {
        market: market('LoL: Team A vs Team B live'),
        book: book(0.12, 0.11, 88, 15),
        currentPrice: 0.115,
      },
      config,
    );
    expect(signal?.action).toBe('BUY');
    expect(signal?.price).toBe(0.12);
  });

  it('live mode rejects ask-only books (no bid to exit into)', () => {
    const signal = LiveQuickFlip.evaluate(
      {
        market: market('Valorant: Team A vs Team B'),
        book: book(0.05, undefined, 1000),
        currentPrice: 0.05,
      },
      config,
    );
    expect(signal).toBeNull();
  });

  it('live mode enters when bid depth covers the position size', () => {
    const signal = LiveQuickFlip.evaluate(
      {
        market: market('Valorant: Team A vs Team B'),
        book: book(0.05, 0.048, 100, 25),
        currentPrice: 0.049,
      },
      config,
    );
    expect(signal?.action).toBe('BUY');
    expect(signal?.size).toBe(20);
  });

  it('balanced mode rejects ask-only books', () => {
    const balanced = resolveStrategyConfig({
      maxSizeUsd: 1,
      tradingGoal: 'quick-flip',
      tradingStyle: 'balanced',
      targetProfitMultiple: 2.5,
      liveMarketsOnly: true,
    });
    const signal = LiveQuickFlip.evaluate(
      {
        market: market('Valorant: Team A vs Team B'),
        book: book(0.25, undefined, 50),
        currentPrice: 0.25,
      },
      balanced,
    );
    expect(signal).toBeNull();
  });

  it('rejects live entries above the 45¢ cap even with headroom to 2× band', () => {
    const signal = LiveQuickFlip.evaluate(
      {
        market: market('LoL: Team A vs Team B live'),
        book: book(0.96, 0.94, 100, 50),
        currentPrice: 0.95,
      },
      config,
    );
    expect(signal).toBeNull();
  });

  it('rejects entries above the 2× entry cap', () => {
    const signal = LiveQuickFlip.evaluate(
      {
        market: market('Bitcoin Up or Down - short window'),
        book: book(0.65, 0.63, 40, 35),
        currentPrice: 0.64,
      },
      config,
    );
    expect(signal).toBeNull();
    expect(maxQuickFlipEntryPrice()).toBeCloseTo(0.495, 2);
  });

  it('rejects asks below the live minimum entry price floor (1.5¢)', () => {
    const signal = LiveQuickFlip.evaluate(
      {
        market: market('Counter-Strike: Team A vs Team B'),
        book: book(0.001, 0.001, 1000, 1000),
        currentPrice: 0.001,
      },
      config,
    );
    expect(signal).toBeNull();
  });

  it('live-quick-flip type normalizes min entry to 1.5¢', () => {
    const cfg = resolveStrategyConfigForType('live-quick-flip', {
      maxSizeUsd: 1,
      targetProfitPct: 50,
    });
    expect(cfg.minEntryPrice).toBe(0.015);
    expect(cfg.maxHoldSeconds).toBe(180);
  });

  it('respects a custom minEntryPrice override', () => {
    const strict = resolveStrategyConfig({
      maxSizeUsd: 1,
      targetProfitPct: 150,
      cooldownSeconds: 15,
      tradingGoal: 'quick-flip',
      tradingStyle: 'aggressive',
      targetProfitMultiple: 2.5,
      liveMarketsOnly: true,
      minEntryPrice: 0.15,
    });
    const signal = LiveQuickFlip.evaluate(
      {
        market: market('NBA: Team A vs Team B live'),
        book: book(0.12, 0.11, 200, 50),
        currentPrice: 0.115,
      },
      strict,
    );
    expect(signal).toBeNull();
  });

  it('live mode rejects wide spreads above 35%', () => {
    const signal = LiveQuickFlip.evaluate(
      {
        market: market('Valorant: Team A vs Team B'),
        book: book(0.10, 0.05, 100, 50),
        currentPrice: 0.075,
      },
      config,
    );
    expect(signal).toBeNull();
  });

  it('live mode allows spreads up to 35% when bid depth is sufficient', () => {
    const signal = LiveQuickFlip.evaluate(
      {
        market: market('LoL: Team A vs Team B live'),
        book: book(0.10, 0.08, 100, 25),
        currentPrice: 0.09,
      },
      config,
    );
    expect(signal?.action).toBe('BUY');
  });

  it('live mode rejects when bid notional is below stake', () => {
    const signal = LiveQuickFlip.evaluate(
      {
        market: market('Valorant: Team A vs Team B'),
        book: book(0.05, 0.048, 100, 20),
        currentPrice: 0.049,
      },
      config,
    );
    expect(signal).toBeNull();
  });

  it('rejects markets resolving after 3 hours', () => {
    const signal = LiveQuickFlip.evaluate(
      {
        market: market('ATP final', 5),
        book: book(0.30, 0.28),
        currentPrice: 0.29,
      },
      config,
    );
    expect(signal).toBeNull();
  });
});
