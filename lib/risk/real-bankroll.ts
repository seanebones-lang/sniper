import { db } from '@/lib/db';
import { categorizeMarket } from '@/lib/risk/categorizer';
import type { PortfolioState } from '@/lib/risk/portfolio-manager';

/** Exposure + equity for live Polymarket sizing (not paper ledger). */
export async function loadRealRiskSnapshot(balanceUsd: number): Promise<{
  state: PortfolioState;
  equityUsd: number;
}> {
  const openPositions = (await db.query.positions?.findMany?.({ limit: 100 })) ?? [];

  let totalExposure = 0;
  const categoryExposures: Record<string, number> = {};

  for (const pos of openPositions) {
    const size = Math.abs(parseFloat(pos.sizeShares) || 0);
    const price = parseFloat(pos.avgPrice) || 0;
    const usd = size * price;
    totalExposure += usd;
    const cat = categorizeMarket('', pos.platform, pos.marketId).category;
    categoryExposures[cat] = (categoryExposures[cat] || 0) + usd;
  }

  const pending = (await db.query.realTrades?.findMany?.({
    where: (t, { eq }) => eq(t.status, 'pending'),
    limit: 50,
  })) ?? [];

  for (const t of pending) {
    const usd = Math.abs(parseFloat(t.size) * parseFloat(t.price));
    totalExposure += usd;
    const cat = categorizeMarket('', t.platform, t.marketExternalId).category;
    categoryExposures[cat] = (categoryExposures[cat] || 0) + usd;
  }

  const cashUsd = Math.max(0, balanceUsd - totalExposure);

  return {
    equityUsd: balanceUsd,
    state: {
      totalExposureUsd: totalExposure,
      dailyPnl: 0,
      maxDrawdown: 0,
      openPositions: openPositions.length,
      categoryExposures,
    },
  };
}
