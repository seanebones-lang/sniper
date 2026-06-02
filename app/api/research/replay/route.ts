import { NextResponse } from 'next/server';
import { replayStrategyOnHistory } from '@/lib/data/historical';
import { getStrategy } from '@/lib/strategies';
import { getAllVariants, applyVariantConfig } from '@/lib/strategies/variants';

export async function POST(req: Request) {
  const body = await req.json();

  const { platform, marketExternalId, strategyType, hours = 24, variantId } = body;

  if (!platform || !marketExternalId || !strategyType) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const baseStrategy = getStrategy(strategyType);
  if (!baseStrategy) {
    return NextResponse.json({ error: 'Strategy not found' }, { status: 404 });
  }

  const strategy = baseStrategy;
  let config = {
    maxSizeUsd: 100,
    targetProfitPct: 2.5,
    cooldownSeconds: 300,
    minSpreadPct: 1.8,
    entryThreshold: 0.46,
  };

  // Apply variant if provided
  if (variantId) {
    const variants = getAllVariants();
    const variant = variants.find(v => v.id === variantId && v.baseStrategyId === strategyType);
    if (variant) {
      config = applyVariantConfig(config, variant) as typeof config;
      // Note: For full variant support we would need a wrapper strategy, but config override is the main effect for now
    }
  }

  const to = new Date();
  const from = new Date(Date.now() - hours * 3600 * 1000);

  const useRealistic = body.realisticPassiveFills ?? false;

  try {
    const result = await replayStrategyOnHistory({
      platform,
      marketExternalId,
      from,
      to,
      strategy,
      config,
      realisticPassiveFills: useRealistic,
    });

    return NextResponse.json({
      ...result,
      variantId: variantId || null,
      configUsed: config,
      realisticPassiveFills: useRealistic,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
