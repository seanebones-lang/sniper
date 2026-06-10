import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getErrorMessage } from '@/lib/error-message';
import { requireApiAuth } from '@/lib/api-auth';
import { db, strategies } from '@/lib/db';
import { normalizeStrategyConfig } from '@/lib/strategies/run-profile';

export async function GET() {
  const rows = await db.query.strategies.findMany({
    orderBy: (s, { desc }) => desc(s.createdAt),
  });
  return NextResponse.json(rows);
}

const postSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.string().min(1).max(40).default('spread-scalper'),
  config: z.record(z.string(), z.unknown()).default({}),
  paperOnly: z.boolean().default(true),
});

export async function POST(req: Request) {
  const authErr = requireApiAuth(req);
  if (authErr) return authErr;

  try {
    const body = postSchema.parse(await req.json());
    const config = normalizeStrategyConfig(body.type, body.config);

    const [newStrat] = await db.insert(strategies).values({
      name: body.name,
      type: body.type,
      config,
      paperOnly: body.paperOnly,
      isActive: false,
      maxSizeUsd: String(config.maxSizeUsd ?? 100),
      targetProfitPct: String(config.targetProfitPct ?? 2.5),
      cooldownSeconds: Number(config.cooldownSeconds ?? 300),
    }).returning();

    return NextResponse.json(newStrat);
  } catch (err: unknown) {
    return NextResponse.json({ error: getErrorMessage(err) || 'Invalid request' }, { status: 400 });
  }
}
