import { db, markets } from '@/lib/db';
import type { Market } from '@/lib/types';

/**
 * ensureMarketRecord
 *
 * Upserts a market (from live API) into the `markets` table using (platform, externalId) as the natural key.
 * Always returns the stable internal UUID that should be used for `signals.market_id` and `positions.market_id`.
 *
 * This is the REQUIRED step before creating any Signal that references a market.
 * It eliminates the foreign key mismatch that previously broke the automated runner fill pipeline.
 */
export async function ensureMarketRecord(market: Market): Promise<string> {
  if (!market.platform || !market.externalId) {
    throw new Error(`ensureMarketRecord: missing platform or externalId (got ${JSON.stringify({
      platform: market.platform,
      externalId: market.externalId,
    })})`);
  }

  const [row] = await db
    .insert(markets)
    .values({
      platform: market.platform,
      externalId: market.externalId,
      question: market.question,
      status: market.status ?? 'open',
      volume: market.volume != null ? market.volume.toString() : null,
      liquidity: market.liquidity != null ? market.liquidity.toString() : null,
      lastPrice: market.lastPrice != null ? market.lastPrice.toString() : null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [markets.platform, markets.externalId],
      set: {
        question: market.question,
        status: market.status ?? 'open',
        volume: market.volume != null ? market.volume.toString() : null,
        liquidity: market.liquidity != null ? market.liquidity.toString() : null,
        lastPrice: market.lastPrice != null ? market.lastPrice.toString() : null,
        updatedAt: new Date(),
      },
    })
    .returning({ id: markets.id });

  if (!row?.id) {
    throw new Error(`ensureMarketRecord: upsert succeeded but no id returned for ${market.platform}:${market.externalId}`);
  }

  return row.id;
}

/**
 * Convenience wrapper for the common case inside the runner/strategies.
 * Accepts either a full Market object or the minimal identifying fields.
 */
export async function ensureMarket(
  input: Market | { platform: 'polymarket' | 'kalshi'; externalId: string; question?: string; status?: string }
): Promise<string> {
  // If it already looks like a persisted Market with a real UUID id, trust it (defensive)
  if ('id' in input && typeof input.id === 'string' && input.id.includes('-')) {
    // Heuristic: real DB UUIDs contain dashes. External IDs usually do not (or are very long hex).
    return input.id;
  }

  const marketLike: Market = {
    id: '', // will be overwritten by upsert
    platform: input.platform,
    externalId: input.externalId,
    question: 'question' in input ? (input.question ?? 'Unknown market') : 'Unknown market',
    status: ('status' in input ? input.status : 'open') as any,
    updatedAt: new Date().toISOString(),
  };

  return ensureMarketRecord(marketLike);
}
