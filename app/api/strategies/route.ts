import { NextResponse } from 'next/server';
import { db, strategies } from '@/lib/db';
import { eq } from 'drizzle-orm';

export async function GET() {
  const rows = await db.query.strategies.findMany({
    orderBy: (s, { desc }) => desc(s.createdAt),
  });
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const body = await req.json();

  const [newStrat] = await db.insert(strategies).values({
    name: body.name,
    type: body.type,
    config: body.config,
    paperOnly: body.paperOnly ?? true,
    isActive: false,
  }).returning();

  return NextResponse.json(newStrat);
}
