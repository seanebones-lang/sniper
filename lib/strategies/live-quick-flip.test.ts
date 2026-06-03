import { describe, expect, it } from 'vitest';
import { LiveQuickFlip, maxQuickFlipEntryPrice } from './live-quick-flip';
import { resolveStrategyConfig } from './run-profile';
import type { Market, OrderBook } from '../types';

function market(question: string, endHours = 2): Market {
  return {
    id: 'm1',
    platform: 'polymarket',
    externalId: 'tok-1',
    question,
    status: 'open',
    volume: 10_000,
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
        market: market('Bitcoin Up or Down - June 2, 1AM ET'),
        book: book(0.12, 0.11, 88, 11),
        currentPrice: 0.115,
      },
      config,
    );
    expect(signal?.action).toBe('BUY');
    expect(signal?.price).toBe(0.12);
  });

  it('rejects ask-only books (no bid = no exit for a flip)', () => {
    const signal = LiveQuickFlip.evaluate(
      {
        market: market('Valorant: Team A vs Team B'),
        book: book(0.25, undefined, 50),
        currentPrice: 0.25,
      },
      config,
    );
    expect(signal).toBeNull();
  });

  it('rejects entries above the 2.5× price cap', () => {
    const signal = LiveQuickFlip.evaluate(
      {
        market: market('Bitcoin Up or Down - short window'),
        book: book(0.65, 0.63, 40, 35),
        currentPrice: 0.64,
      },
      config,
    );
    expect(signal).toBeNull();
    expect(maxQuickFlipEntryPrice(2.5)).toBeCloseTo(0.396, 2);
  });

  it('rejects dead longshots below the minimum entry price (0.1¢)', () => {
    const signal = LiveQuickFlip.evaluate(
      {
        market: market('Counter-Strike: Team A vs Team B'),
        book: book(0.001, 0.0005, 1000, 1000),
        currentPrice: 0.001,
      },
      config,
    );
    expect(signal).toBeNull();
  });

  it('still enters asks at/above the 0.1¢ minimum entry floor', () => {
    const signal = LiveQuickFlip.evaluate(
      {
        market: market('NBA: Team A vs Team B live'),
        book: book(0.001, 0.0005, 200, 50),
        currentPrice: 0.00075,
      },
      config,
    );
    expect(signal?.action).toBe('BUY');
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
