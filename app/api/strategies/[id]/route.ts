import { NextResponse } from 'next/server';
import { db, strategies } from '@/lib/db';
import { eq } from 'drizzle-orm';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();

  await db.update(strategies)
    .set({ isActive: body.isActive, updatedAt: new Date() })
    .where(eq(strategies.id, id));

  return NextResponse.json({ success: true });
}
