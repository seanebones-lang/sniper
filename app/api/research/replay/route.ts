import { NextResponse } from 'next/server';
import { replayStrategyOnHistory } from '@/lib/data/historical';
import { getStrategy } from '@/lib/strategies';

export async function POST(req: Request) {
  const body = await req.json();

  const { platform, marketExternalId, strategyType, hours = 24 } = body;

  if (!platform || !marketExternalId || !strategyType) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const strategy = getStrategy(strategyType);
  if (!strategy) {
    return NextResponse.json({ error: 'Strategy not found' }, { status: 404 });
  }

  const to = new Date();
  const from = new Date(Date.now() - hours * 3600 * 1000);

  const config = {
    maxSizeUsd: 100,
    targetProfitPct: 2.5,
    cooldownSeconds: 300,
    minSpreadPct: 1.8,
    entryThreshold: 0.46,
  };

  try {
    const result = await replayStrategyOnHistory({
      platform,
      marketExternalId,
      from,
      to,
      strategy,
      config,
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
