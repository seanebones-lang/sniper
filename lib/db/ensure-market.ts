import { sql } from 'drizzle-orm';
import { db, markets } from '@/lib/db';
import type { Market } from '@/lib/types';

/**
 * Upsert a discovered market into the `markets` table and return its DB UUID.
 * Required before inserting `signals` (FK on markets.id).
 */
export async function ensureMarketRecord(
  market: Pick<Market, 'platform' | 'externalId'> & Partial<Market>,
): Promise<string> {
  if (!market.platform || !market.externalId) {
    throw new Error('ensureMarketRecord: missing platform or externalId');
  }

  const question = market.question ?? `${market.platform}:${market.externalId}`;
  const status = market.status ?? 'open';
  const [row] = await db
    .insert(markets)
    .values({
      platform: market.platform,
      externalId: market.externalId,
      question,
      status,
      volume: market.volume != null ? market.volume.toString() : null,
      liquidity: market.liquidity != null ? market.liquidity.toString() : null,
      lastPrice: market.lastPrice != null ? market.lastPrice.toString() : null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [markets.platform, markets.externalId],
      set: {
        question: market.question,
        status: market.status,
        volume: market.volume != null ? market.volume.toString() : null,
        liquidity: market.liquidity != null ? market.liquidity.toString() : null,
        lastPrice: market.lastPrice != null ? market.lastPrice.toString() : null,
        updatedAt: new Date(),
      },
    })
    .returning({ id: markets.id });

  if (!row?.id) {
    throw new Error('ensureMarketRecord: upsert succeeded but no id returned');
  }

  return row.id;
}

/** Alias used by reconciliation and real-executor paths. */
export const ensureMarket = ensureMarketRecord;

const BATCH_UPSERT_CHUNK = 100;

/**
 * Batch upsert of discovered markets — one INSERT … ON CONFLICT per chunk
 * instead of one round-trip per market (the runner syncs ~50 markets/cycle).
 * Returns a map of `${platform}:${externalId}` → DB UUID.
 *
 * When a market has no question, the insert uses the `platform:externalId`
 * placeholder; the CASE in the update keeps the existing question in that
 * case, matching ensureMarketRecord's skip-when-undefined behavior.
 */
export async function ensureMarketRecordsBatch(
  input: Array<Pick<Market, 'platform' | 'externalId'> & Partial<Market>>,
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  // ON CONFLICT DO UPDATE cannot touch the same row twice in one statement.
  const byKey = new Map<string, (typeof input)[number]>();
  for (const m of input) {
    if (!m.platform || !m.externalId) continue;
    byKey.set(`${m.platform}:${m.externalId}`, m);
  }
  const unique = [...byKey.values()];

  for (let i = 0; i < unique.length; i += BATCH_UPSERT_CHUNK) {
    const chunk = unique.slice(i, i + BATCH_UPSERT_CHUNK);
    try {
      const rows = await db
        .insert(markets)
        .values(
          chunk.map((m) => ({
            platform: m.platform,
            externalId: m.externalId,
            question: m.question ?? `${m.platform}:${m.externalId}`,
            status: m.status ?? 'open',
            volume: m.volume != null ? m.volume.toString() : null,
            liquidity: m.liquidity != null ? m.liquidity.toString() : null,
            lastPrice: m.lastPrice != null ? m.lastPrice.toString() : null,
            updatedAt: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: [markets.platform, markets.externalId],
          set: {
            question: sql`CASE WHEN excluded.question = excluded.platform || ':' || excluded.external_id THEN ${markets.question} ELSE excluded.question END`,
            status: sql`excluded.status`,
            volume: sql`excluded.volume`,
            liquidity: sql`excluded.liquidity`,
            lastPrice: sql`excluded.last_price`,
            updatedAt: sql`excluded.updated_at`,
          },
        })
        .returning({
          id: markets.id,
          platform: markets.platform,
          externalId: markets.externalId,
        });

      for (const row of rows) {
        ids.set(`${row.platform}:${row.externalId}`, row.id);
      }
    } catch (err) {
      // Batch failed (e.g. one bad row) — fall back to per-row upserts so a
      // single market can't poison the whole sync.
      console.warn('[ensureMarketRecordsBatch] chunk upsert failed; falling back per-row:', err);
      for (const m of chunk) {
        try {
          const id = await ensureMarketRecord(m);
          ids.set(`${m.platform}:${m.externalId}`, id);
        } catch (rowErr) {
          console.warn(`[ensureMarketRecordsBatch] failed for ${m.platform}:${m.externalId}`, rowErr);
        }
      }
    }
  }

  return ids;
}
