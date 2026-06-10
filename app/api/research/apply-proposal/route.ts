import { NextResponse } from 'next/server';
import { requireApiAuth } from '@/lib/api-auth';
import { createVariantFromProposal } from '@/lib/strategies/variants';
import { replayStrategyOnHistory, type ReplayResult } from '@/lib/data/historical';
import { getStrategy } from '@/lib/strategies';
import type { StrategyProposal } from '@/lib/research/grok-agent';
import type { Platform } from '@/lib/types';

interface MarketComparison {
  market: { platform: Platform; marketExternalId: string };
  base: ReplayResult;
  variant: ReplayResult;
  deltaPnl: number;
}

const DEFAULT_CONFIG = {
  maxSizeUsd: 100,
  targetProfitPct: 2.5,
  cooldownSeconds: 300,
  minSpreadPct: 1.8,
  entryThreshold: 0.46,
};

export async function POST(req: Request) {
  const authErr = requireApiAuth(req);
  if (authErr) return authErr;

  const body = await req.json().catch(() => null);
  const { proposal, autoCompare = true } = (body ?? {}) as {
    proposal?: StrategyProposal;
    autoCompare?: boolean;
  };

  if (!proposal || typeof proposal !== 'object') {
    return NextResponse.json({ error: 'Proposal required' }, { status: 400 });
  }

  const variant = createVariantFromProposal(proposal);

  let comparisons: MarketComparison[] | null = null;

  if (autoCompare) {
    const testMarkets: Array<{ platform: Platform; marketExternalId: string }> = [
      { platform: 'polymarket', marketExternalId: '0x1234...example-btc-15m' },
    ];

    const baseStrategy = getStrategy(proposal.strategyId);
    const comparisonsResults: MarketComparison[] = [];

    for (const m of testMarkets) {
      if (!baseStrategy) continue;

      try {
        const to = new Date();
        const from = new Date(Date.now() - 24 * 3600 * 1000);

        const baseResult = await replayStrategyOnHistory({
          platform: m.platform,
          marketExternalId: m.marketExternalId,
          from,
          to,
          strategy: baseStrategy,
          config: DEFAULT_CONFIG,
        });

        const variantConfig = { ...DEFAULT_CONFIG, ...proposal.suggestedChange };
        const variantResult = await replayStrategyOnHistory({
          platform: m.platform,
          marketExternalId: m.marketExternalId,
          from,
          to,
          strategy: baseStrategy,
          config: variantConfig,
        });

        comparisonsResults.push({
          market: m,
          base: baseResult,
          variant: variantResult,
          deltaPnl: (variantResult.totalPnl || 0) - (baseResult.totalPnl || 0),
        });
      } catch {
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
      : 'Variant created from proposal.',
  });
}
