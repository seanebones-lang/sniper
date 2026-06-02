import { db, markets } from '@/lib/db';
import type { Market } from '@/lib/types';

/**
 * Upsert a discovered market into the `markets` table and return its DB UUID.
 * Required before inserting `signals` (FK on markets.id).
 */
export async function ensureMarketRecord(
  market: Pick<Market, 'platform' | 'externalId'> & Partial<Market>,
): Promise<string> {
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

  return row.id;
}

/** Alias used by reconciliation and real-executor paths. */
export const ensureMarket = ensureMarketRecord;
