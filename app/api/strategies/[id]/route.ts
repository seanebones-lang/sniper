import { NextResponse } from 'next/server';
import { db, strategies } from '@/lib/db';
import { eq } from 'drizzle-orm';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.isActive === 'boolean') updates.isActive = body.isActive;
  // Allow flipping a strategy between paper and real execution. This is the
  // second half of the real-execution gate in lib/runner/engine.ts; without it
  // a strategy can never leave paperOnly=true and real orders never fire.
  if (typeof body.paperOnly === 'boolean') updates.paperOnly = body.paperOnly;

  await db.update(strategies)
    .set(updates)
    .where(eq(strategies.id, id));

  return NextResponse.json({ success: true });
}
