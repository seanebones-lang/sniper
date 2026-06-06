import type { Strategy } from './types';
import { SpreadScalper } from './spread-scalper';
import { ThresholdStrategy } from './threshold';
import { OrderBookImbalance } from './orderbook-imbalance';
import { ResolutionProximitySniper } from './resolution-proximity';
import { LiveQuickFlip } from './live-quick-flip';
import { BtcSniper } from './btc-sniper';

export const strategyRegistry: Record<string, Strategy> = {
  [SpreadScalper.id]: SpreadScalper,
  [ThresholdStrategy.id]: ThresholdStrategy,
  [OrderBookImbalance.id]: OrderBookImbalance,
  [ResolutionProximitySniper.id]: ResolutionProximitySniper,
  [LiveQuickFlip.id]: LiveQuickFlip,
  [BtcSniper.id]: BtcSniper,
};

export function getStrategy(type: string): Strategy | undefined {
  return strategyRegistry[type];
}

export const availableStrategies = Object.values(strategyRegistry);
