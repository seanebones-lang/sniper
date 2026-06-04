import type { LedgerTrade } from '@/lib/paper/ledger';
import type { PaperPositionRow } from '@/lib/paper/positions';
import type { StrategyOpenPosition } from '@/lib/strategies/exit-engine';
import { fetchPolymarketOrderBook } from '@/lib/clients/polymarket';
import { resolveExitMarkPrice } from '@/lib/markets/exit-mark-price';
import type { MarkPriceMap } from '@/lib/paper/mark-to-market';

/** Reconstruct initial deposit: current CLOB cash + net cash deployed in fills. */
export function inferLiveStartingBudget(clobCash: number, trades: LedgerTrade[]): number {
  if (trades.length === 0) return clobCash;
  let buySpend = 0;
  let sellProceeds = 0;
  for (const t of trades) {
    const size = parseFloat(t.size);
    const price = parseFloat(t.price);
    const fee = parseFloat(t.fee ?? '0');
    if (!Number.isFinite(size) || !Number.isFinite(price)) continue;
    if (t.side === 'BUY') buySpend += size * price + fee;
    else sellProceeds += size * price - fee;
  }
  return clobCash + buySpend - sellProceeds;
}

export function realPositionsToPaperRows(positions: StrategyOpenPosition[]): PaperPositionRow[] {
  return positions.map((p) => ({
    platform: p.platform,
    marketExternalId: p.marketExternalId,
    netSize: p.netSize,
    avgPrice: p.avgEntryPrice,
    notionalUsd: p.netSize * p.avgEntryPrice,
    side: 'LONG' as const,
  }));
}

/** Live marks — mid-based, ignoring junk bids (same as exit engine). */
export async function fetchLiveMarkPrices(positions: PaperPositionRow[]): Promise<MarkPriceMap> {
  const map: MarkPriceMap = new Map();
  const poly = positions.filter((p) => p.platform === 'polymarket');
  const batchSize = 4;

  for (let i = 0; i < poly.length; i += batchSize) {
    const batch = poly.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (p) => {
        try {
          const book = await fetchPolymarketOrderBook(p.marketExternalId);
          const mark = resolveExitMarkPrice(book, p.avgPrice);
          if (mark != null && mark > 0 && mark <= 1) {
            return { key: `${p.platform}:${p.marketExternalId}`, mark };
          }
        } catch {
          // fall back to cost in computeMarkToMarket
        }
        return null;
      }),
    );
    for (const r of results) {
      if (r) map.set(r.key, r.mark);
    }
  }

  return map;
}
