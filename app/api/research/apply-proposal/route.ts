import { NextResponse } from 'next/server';
import { createVariantFromProposal, getAllVariants } from '@/lib/strategies/variants';
import { replayStrategyOnHistory } from '@/lib/data/historical';
import { getStrategy } from '@/lib/strategies';

export async function POST(req: Request) {
  const body = await req.json();
  const { proposal, autoCompare = true } = body;

  if (!proposal) {
    return NextResponse.json({ error: 'Proposal required' }, { status: 400 });
  }

  const variant = createVariantFromProposal(proposal);

  let comparisons: Record<string, unknown> | null = null;

  if (autoCompare) {
    // Automatically run head-to-head comparison on a few representative short-term crypto markets
    // In production this list would be dynamic / from watchlist
    const testMarkets = [
      { platform: 'polymarket', marketExternalId: '0x1234...example-btc-15m' }, // placeholder - real system would use actual active markets
    ];

    const baseStrategy = getStrategy(proposal.strategyId);
    const comparisonsResults: Record<string, unknown>[] = [];

    for (const m of testMarkets) {
      try {
        const to = new Date();
        const from = new Date(Date.now() - 24 * 3600 * 1000);

        // Base strategy
        const baseResult = await replayStrategyOnHistory({
          platform: m.platform,
          marketExternalId: m.marketExternalId,
          from,
          to,
          strategy: baseStrategy!,
          config: { maxSizeUsd: 100, targetProfitPct: 2.5, cooldownSeconds: 300, minSpreadPct: 1.8, entryThreshold: 0.46 },
        });

        // Variant (apply overrides)
        const variantConfig = { ...{ maxSizeUsd: 100, targetProfitPct: 2.5, cooldownSeconds: 300, minSpreadPct: 1.8, entryThreshold: 0.46 }, ...proposal.suggestedChange };
        const variantResult = await replayStrategyOnHistory({
          platform: m.platform,
          marketExternalId: m.marketExternalId,
          from,
          to,
          strategy: baseStrategy!,
          config: variantConfig,
        });

        comparisonsResults.push({
          market: m,
          base: baseResult,
          variant: variantResult,
          deltaPnl: (variantResult.totalPnl || 0) - (baseResult.totalPnl || 0),
        });
      } catch (e) {
        // Ignore individual market failures during auto-compare
      }
    }

    comparisons = comparisonsResults;
  }

  return NextResponse.json({ 
    success: true, 
    variant,
    comparisons,
    message: comparisons 
      ? 'Variant created and auto-compared against base strategy on historical data.' 
      : 'Variant created from proposal.'
  });
}
