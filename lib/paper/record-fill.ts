import { db, paperTrades, auditEvents } from '@/lib/db';

export interface PaperFillRecord {
  platform: string;
  marketExternalId: string;
  signalId?: string | null;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  fee: number;
}

/** Decimal columns are (18,4) / (5,4) — round before insert. */
function dec4(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return n.toFixed(4);
}

/**
 * Persist a paper fill to `paper_trades`. The runner MUST await this — fire-and-forget
 * inserts were silently dropped (68k signals, 0 paper rows in production).
 */
export async function persistPaperFill(fill: PaperFillRecord): Promise<string | null> {
  try {
    const [row] = await db
      .insert(paperTrades)
      .values({
        platform: fill.platform,
        marketExternalId: fill.marketExternalId,
        signalId: fill.signalId ?? null,
        side: fill.side,
        price: dec4(fill.price),
        size: dec4(fill.size),
        fee: dec4(fill.fee),
        status: 'filled',
      })
      .returning({ id: paperTrades.id });

    return row?.id ?? null;
  } catch (err) {
    console.error('[persistPaperFill] DB insert failed:', err);
    try {
      await db.insert(auditEvents).values({
        actor: 'paper',
        action: 'paper_fill_insert_failed',
        payload: {
          platform: fill.platform,
          marketExternalId: fill.marketExternalId,
          signalId: fill.signalId,
          side: fill.side,
          price: fill.price,
          size: fill.size,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    } catch {
      // best effort
    }
    return null;
  }
}
