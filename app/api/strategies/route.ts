import { NextResponse } from 'next/server';
import { db, strategies } from '@/lib/db';
import { normalizeStrategyConfig } from '@/lib/strategies/run-profile';

export async function GET() {
  const rows = await db.query.strategies.findMany({
    orderBy: (s, { desc }) => desc(s.createdAt),
  });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const body = await req.json();
  const type = String(body.type ?? 'spread-scalper');
  const config = normalizeStrategyConfig(type, (body.config ?? {}) as Record<string, unknown>);

  const [newStrat] = await db.insert(strategies).values({
    name: body.name,
    type,
    config,
    paperOnly: body.paperOnly ?? true,
    isActive: false,
    maxSizeUsd: String(config.maxSizeUsd ?? 100),
    targetProfitPct: String(config.targetProfitPct ?? 2.5),
    cooldownSeconds: Number(config.cooldownSeconds ?? 300),
  }).returning();

  return NextResponse.json(newStrat);
}
