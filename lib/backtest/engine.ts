/**
 * Basic Backtester (Phase 5 foundation)
 * Allows testing strategies against historical or synthetic price series.
 */

import { getStrategy } from '@/lib/strategies';
import type { StrategyConfig } from '@/lib/strategies/types';

export interface BacktestResult {
  totalTrades: number;
  winningTrades: number;
  totalPnl: number;
  maxDrawdown: number;
  trades: Array<{
    price: number;
    side: 'BUY' | 'SELL';
    pnl?: number;
    reason: string;
  }>;
}

export function runBacktest(params: {
  strategyType: string;
  config: StrategyConfig;
  prices: number[];           // historical or simulated prices (0-1)
}): BacktestResult {
  const strategy = getStrategy(params.strategyType);
  if (!strategy) {
    throw new Error('Strategy not found');
  }

  const trades: BacktestResult['trades'] = [];
  let position = 0;
  let entryPrice = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let pnl = 0;

  for (let i = 0; i < params.prices.length; i++) {
    const price = params.prices[i];

    const fakeMarket = {
      id: 'backtest',
      platform: 'polymarket' as const,
      externalId: 'backtest',
      question: 'Backtest Market',
      status: 'open' as const,
      updatedAt: new Date().toISOString(),
    };

    const signal = strategy.evaluate(
      { market: fakeMarket, currentPrice: price },
      params.config
    );

    if (signal && signal.action !== 'HOLD') {
      if (signal.action === 'BUY' && position <= 0) {
        position = signal.size;
        entryPrice = price;
        trades.push({ price, side: 'BUY', reason: signal.reason });
      } else if (signal.action === 'SELL' && position > 0) {
        const tradePnl = (price - entryPrice) * position;
        pnl += tradePnl;
        trades.push({ price, side: 'SELL', pnl: tradePnl, reason: signal.reason });

        // Update drawdown
        const equity = pnl;
        if (equity > peak) peak = equity;
        const dd = peak - equity;
        if (dd > maxDrawdown) maxDrawdown = dd;

        position = 0;
      }
    }
  }

  const winningTrades = trades.filter(t => (t.pnl ?? 0) > 0).length;

  return {
    totalTrades: trades.length,
    winningTrades,
    totalPnl: pnl,
    maxDrawdown,
    trades,
  };
}
