export interface PaperPositionRow {
  platform: string;
  marketExternalId: string;
  netSize: number;
  avgPrice: number;
  notionalUsd: number;
  side: 'LONG' | 'SHORT';
}

export function aggregatePaperPositions(trades: Array<{
  platform: string;
  marketExternalId: string;
  side: string;
  size: string;
  price: string;
}>): PaperPositionRow[] {
  const map = new Map<string, { platform: string; marketExternalId: string; netSize: number; costBasis: number }>();

  for (const t of trades) {
    const key = `${t.platform}:${t.marketExternalId}`;
    const size = parseFloat(t.size);
    const price = parseFloat(t.price);
    const row = map.get(key) ?? {
      platform: t.platform,
      marketExternalId: t.marketExternalId,
      netSize: 0,
      costBasis: 0,
    };

    if (t.side === 'BUY') {
      row.costBasis += size * price;
      row.netSize += size;
    } else {
      const avg = row.netSize > 0.01 ? row.costBasis / row.netSize : price;
      row.netSize -= size;
      row.costBasis -= avg * size;
      if (row.netSize <= 0.01) {
        row.netSize = 0;
        row.costBasis = 0;
      }
    }
    map.set(key, row);
  }

  return Array.from(map.values())
    .filter((p) => Math.abs(p.netSize) > 0.01)
    .map((p) => {
      const avgPrice = p.netSize !== 0 ? Math.abs(p.costBasis / p.netSize) : 0;
      return {
        platform: p.platform,
        marketExternalId: p.marketExternalId,
        netSize: p.netSize,
        avgPrice,
        notionalUsd: Math.abs(p.netSize * avgPrice),
        side: (p.netSize > 0 ? 'LONG' : 'SHORT') as 'LONG' | 'SHORT',
      };
    })
    .sort((a, b) => b.notionalUsd - a.notionalUsd);
}

export function totalExposureUsd(positions: PaperPositionRow[]): number {
  return positions.reduce((sum, p) => sum + p.notionalUsd, 0);
}
