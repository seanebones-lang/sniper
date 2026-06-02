/**
 * Derive lightweight regime / feature labels from recent market snapshots.
 */

export interface SnapshotFeatures {
  regime: string;
  volatilityProxy: number;
  imbalancePersistence: number;
}

export function extractFeaturesFromRecentSnapshots(
  snapshots: Array<{ mid?: string | number | null; imbalance?: string | number | null }>,
): SnapshotFeatures {
  if (!snapshots.length) {
    return {
      regime: 'normal',
      volatilityProxy: 0,
      imbalancePersistence: 0,
    };
  }

  const mids = snapshots
    .map(s => (s.mid != null ? Number(s.mid) : NaN))
    .filter(n => !Number.isNaN(n));

  const volatilityProxy =
    mids.length > 1 ? Math.max(...mids) - Math.min(...mids) : 0;

  const imbalances = snapshots
    .map(s => (s.imbalance != null ? Number(s.imbalance) : 0))
    .filter(n => !Number.isNaN(n));

  const avgImbalance =
    imbalances.length > 0
      ? imbalances.reduce((sum, v) => sum + v, 0) / imbalances.length
      : 0;

  let regime = 'normal';
  if (volatilityProxy > 0.05) regime = 'high_volatility';
  else if (volatilityProxy < 0.008) regime = 'low_liquidity';

  return {
    regime,
    volatilityProxy: parseFloat(volatilityProxy.toFixed(4)),
    imbalancePersistence: parseFloat(Math.abs(avgImbalance).toFixed(4)),
  };
}
