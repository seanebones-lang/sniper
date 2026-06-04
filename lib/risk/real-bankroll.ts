import { db } from '@/lib/db';
import { categorizeMarket } from '@/lib/risk/categorizer';
import type { PortfolioState } from '@/lib/risk/portfolio-manager';

/** Exposure + equity for live Polymarket sizing (not paper ledger). */
export async function loadRealRiskSnapshot(
  balanceUsd: number,
  liveStrategyIds: string[] = [],
): Promise<{
  state: PortfolioState;
  equityUsd: number;
}> {
  let totalExposure = 0;
  const categoryExposures: Record<string, number> = {};
  let openCount = 0;

  if (liveStrategyIds.length > 0) {
    const { getRealOpenPositionsByStrategy } = await import('@/lib/execution/real-positions');
    const byStrategy = await getRealOpenPositionsByStrategy(liveStrategyIds);
    for (const positions of byStrategy.values()) {
      for (const p of positions) {
        const usd = p.netSize * p.avgEntryPrice;
        if (usd <= 0.001) continue;
        totalExposure += usd;
        openCount++;
        const cat = categorizeMarket('', p.platform, p.marketExternalId).category;
        categoryExposures[cat] = (categoryExposures[cat] || 0) + usd;
      }
    }
  } else {
    const openPositions = (await db.query.positions?.findMany?.({ limit: 100 })) ?? [];
    for (const pos of openPositions) {
      const size = Math.abs(parseFloat(pos.sizeShares) || 0);
      const price = parseFloat(pos.avgPrice) || 0;
      const usd = size * price;
      if (usd <= 0.001) continue;
      totalExposure += usd;
      openCount++;
      const cat = categorizeMarket('', pos.platform, pos.marketId).category;
      categoryExposures[cat] = (categoryExposures[cat] || 0) + usd;
    }
  }

  const pending = (await db.query.realTrades?.findMany?.({
    where: (t, { eq }) => eq(t.status, 'pending'),
    limit: 50,
  })) ?? [];

  for (const t of pending) {
    const usd = Math.abs(parseFloat(t.size) * parseFloat(t.price));
    if (usd <= 0.001) continue;
    totalExposure += usd;
    const cat = categorizeMarket('', t.platform, t.marketExternalId).category;
    categoryExposures[cat] = (categoryExposures[cat] || 0) + usd;
  }

  return {
    equityUsd: balanceUsd,
    state: {
      totalExposureUsd: totalExposure,
      dailyPnl: 0,
      maxDrawdown: 0,
      openPositions: openCount,
      categoryExposures,
    },
  };
}
