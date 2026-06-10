import { NextResponse } from 'next/server';
import { db, strategies } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { normalizeStrategyConfig } from '@/lib/strategies/run-profile';
import { requireApiAuth } from '@/lib/api-auth';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const authErr = requireApiAuth(req);
  if (authErr) return authErr;

  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const existing = await db.query.strategies.findFirst({
    where: eq(strategies.id, id),
    columns: { type: true, config: true },
  });
  if (!existing) {
    return NextResponse.json({ error: 'Strategy not found' }, { status: 404 });
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.isActive === 'boolean') updates.isActive = body.isActive;
  // Allow flipping a strategy between paper and real execution. This is the
  // second half of the real-execution gate in lib/runner/engine.ts; without it
  // a strategy can never leave paperOnly=true and real orders never fire.
  if (typeof body.paperOnly === 'boolean') {
    updates.paperOnly = body.paperOnly;
    // Going live: never leave the loop running from a prior session — user must start explicitly.
    if (body.paperOnly === false) {
      const { stopRunner } = await import('@/lib/runner/engine');
      stopRunner();
    }
  }

  if (body.config && typeof body.config === 'object') {
    const merged = { ...(existing.config as Record<string, unknown>), ...(body.config as Record<string, unknown>) };
    const config = normalizeStrategyConfig(existing.type, merged);
    updates.config = config;
    if (typeof config.maxSizeUsd === 'number') updates.maxSizeUsd = String(config.maxSizeUsd);
    if (typeof config.targetProfitPct === 'number') updates.targetProfitPct = String(config.targetProfitPct);
    if (typeof config.cooldownSeconds === 'number') updates.cooldownSeconds = config.cooldownSeconds;
  }

  await db.update(strategies)
    .set(updates)
    .where(eq(strategies.id, id));

  return NextResponse.json({ success: true });
}
