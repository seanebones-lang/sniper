import type { Strategy } from './types';
import { SpreadScalper } from './spread-scalper';
import { ThresholdStrategy } from './threshold';
import { OrderBookImbalance } from './orderbook-imbalance';
import { ResolutionProximitySniper } from './resolution-proximity';
import { LiveQuickFlip } from './live-quick-flip';

export const strategyRegistry: Record<string, Strategy> = {
  [SpreadScalper.id]: SpreadScalper,
  [ThresholdStrategy.id]: ThresholdStrategy,
  [OrderBookImbalance.id]: OrderBookImbalance,
  [ResolutionProximitySniper.id]: ResolutionProximitySniper,
  [LiveQuickFlip.id]: LiveQuickFlip,
};

export function getStrategy(type: string): Strategy | undefined {
  return strategyRegistry[type];
}

export const availableStrategies = Object.values(strategyRegistry);
