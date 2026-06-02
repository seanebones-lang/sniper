import { NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/error-message';
import { z } from 'zod';
import { db, paperTrades, auditEvents } from '@/lib/db';
import { paperSimulator } from '@/lib/execution/paper-simulator';
import { getMarket } from '@/lib/markets';

const bodySchema = z.object({
  platform: z.enum(['polymarket', 'kalshi']),
  marketExternalId: z.string().min(1),
  side: z.enum(['BUY', 'SELL']),
  price: z.number().gt(0).lt(1),
  size: z.number().gt(0),
  reason: z.string().optional(),
});

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const parsed = bodySchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { platform, marketExternalId, side, price, size, reason } = parsed.data;
    const market = await getMarket(platform, marketExternalId);

    const fill = paperSimulator.snipe({
      market: market ?? {
        id: marketExternalId,
        platform,
        externalId: marketExternalId,
        question: `${platform} ${marketExternalId}`,
        status: 'open',
        updatedAt: new Date().toISOString(),
      },
      side,
      price,
      size,
      reason: reason ?? `Manual paper fill @ ${(price * 100).toFixed(1)}¢`,
      immediate: true,
    });

    if (!fill) {
      return NextResponse.json({ error: 'Fill rejected — check price and size' }, { status: 422 });
    }

    const [saved] = await db.insert(paperTrades).values({
      platform: fill.platform,
      marketExternalId: fill.marketExternalId,
      side: fill.side,
      price: fill.price.toString(),
      size: fill.size.toString(),
      fee: fill.fee.toString(),
      status: 'filled',
    }).returning();

    await db.insert(auditEvents).values({
      actor: 'user',
      action: 'manual_paper_fill',
      payload: { fillId: saved.id, side, price, size, platform, marketExternalId },
    });

    return NextResponse.json({ fill, persistedId: saved.id });
  } catch (err: unknown) {
    console.error('[api/paper/fill]', err);
    return NextResponse.json(
      { error: 'Failed to record paper fill', details: getErrorMessage(err) },
      { status: 500 },
    );
  }
}
