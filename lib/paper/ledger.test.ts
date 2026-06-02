import { describe, it, expect } from 'vitest';
import { computePaperLedger } from './ledger';

describe('computePaperLedger', () => {
  it('tracks profit from a closed round trip (old UI would show flat bankroll)', () => {
    const ledger = computePaperLedger(10_000, [
      {
        platform: 'polymarket',
        marketExternalId: 'm1',
        side: 'BUY',
        size: '100',
        price: '0.50',
        fee: '0.01',
      },
      {
        platform: 'polymarket',
        marketExternalId: 'm1',
        side: 'SELL',
        size: '100',
        price: '0.55',
        fee: '0.01',
      },
    ]);

    expect(ledger.openExposureCostUsd).toBeCloseTo(0, 2);
    expect(ledger.realizedPnLUsd).toBeCloseTo(5, 2);
    expect(ledger.totalEquityUsd).toBeCloseTo(10_004.98, 2);
    expect(ledger.netPnlUsd).toBeCloseTo(4.98, 2);
    expect(ledger.cashUsd + ledger.openExposureCostUsd).toBeCloseTo(ledger.totalEquityUsd, 4);
  });

  it('leaves equity = cash + open cost after partial exit', () => {
    const ledger = computePaperLedger(10_000, [
      {
        platform: 'kalshi',
        marketExternalId: 't1',
        side: 'BUY',
        size: '200',
        price: '0.40',
        fee: '0',
      },
      {
        platform: 'kalshi',
        marketExternalId: 't1',
        side: 'SELL',
        size: '100',
        price: '0.44',
        fee: '0',
      },
    ]);

    expect(ledger.openExposureCostUsd).toBeCloseTo(40, 2);
    expect(ledger.cashUsd).toBeCloseTo(9964, 2);
    expect(ledger.totalEquityUsd).toBeCloseTo(10_004, 2);
  });
});
