import type { Strategy } from './types';
import { SpreadScalper } from './spread-scalper';
import { ThresholdStrategy } from './threshold';
import { OrderBookImbalance } from './orderbook-imbalance';

export const strategyRegistry: Record<string, Strategy> = {
  [SpreadScalper.id]: SpreadScalper,
  [ThresholdStrategy.id]: ThresholdStrategy,
  [OrderBookImbalance.id]: OrderBookImbalance,
};

export function getStrategy(type: string): Strategy | undefined {
  return strategyRegistry[type];
}

export const availableStrategies = Object.values(strategyRegistry);
