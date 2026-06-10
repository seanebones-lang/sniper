import { NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/error-message';
import { requireApiAuth } from '@/lib/api-auth';
import { replayStrategyOnHistory } from '@/lib/data/historical';
import { getStrategy } from '@/lib/strategies';
import { getAllVariants, applyVariantConfig } from '@/lib/strategies/variants';
import { resolveStrategyConfig } from '@/lib/strategies/run-profile';
import type { StrategyConfig } from '@/lib/strategies/types';

/** Replay window cap: bounds the snapshot scan a single request can trigger. */
const MAX_REPLAY_HOURS = 24 * 14;

export async function POST(req: Request) {
  const authErr = requireApiAuth(req);
  if (authErr) return authErr;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { platform, marketExternalId, strategyType, variantId } = body;
  const hours = Math.min(
    MAX_REPLAY_HOURS,
    Math.max(1, Number(body.hours) || 24),
  );

  if (!platform || !marketExternalId || !strategyType) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const baseStrategy = getStrategy(strategyType);
  if (!baseStrategy) {
    return NextResponse.json({ error: 'Strategy not found' }, { status: 404 });
  }

  const strategy = baseStrategy;
  let config: StrategyConfig = resolveStrategyConfig({
    maxSizeUsd: body.config?.maxSizeUsd ?? 1,
    targetProfitPct: body.config?.targetProfitPct ?? 150,
    cooldownSeconds: body.config?.cooldownSeconds ?? 15,
    tradingGoal: body.config?.tradingGoal ?? (strategyType === 'live-quick-flip' ? 'quick-flip' : 'spread-capture'),
    tradingStyle: body.config?.tradingStyle ?? 'aggressive',
    targetProfitMultiple: body.config?.targetProfitMultiple ?? 2.5,
    targetExitValueUsd: body.config?.targetExitValueUsd ?? 2.5,
    liveMarketsOnly: body.config?.liveMarketsOnly ?? strategyType === 'live-quick-flip',
    minSpreadPct: body.config?.minSpreadPct ?? 1.8,
    entryThreshold: body.config?.entryThreshold ?? 0.46,
    stopLossPct: body.config?.stopLossPct,
    maxHoldSeconds: body.config?.maxHoldSeconds,
    ...(body.config ?? {}),
  });

  // Apply variant if provided
  if (variantId) {
    const variants = await getAllVariants();
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
