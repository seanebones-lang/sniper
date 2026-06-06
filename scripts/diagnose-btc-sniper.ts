/**
 * Diagnose BTC sniper discovery + signal hits.
 * Usage: npx tsx scripts/diagnose-btc-sniper.ts
 */
import { getMarketsForBtcSniper, summarizeBtcPool } from '../lib/markets';
import { fetchBtcMarketsBySlug } from '../lib/clients/polymarket-btc-slug';
import { fetchPolymarketBtcNearTermMarkets, fetchPolymarketBtcUpDownSearchMarkets } from '../lib/clients/polymarket-btc-markets';
import { fetchBtcUsdtCloses } from '../lib/clients/ccxt-binance';
import { getAdvancedSignal } from '../lib/btc/signal-engine';
import { fetchPolymarketOrderBook } from '../lib/clients/polymarket';
import { resolveUpPriceFromBooks } from '../lib/btc/signal-engine';

async function main() {
  const slugResults = await fetchBtcMarketsBySlug();
  const nearTerm = await fetchPolymarketBtcNearTermMarkets(2, 50);
  const search = await fetchPolymarketBtcUpDownSearchMarkets();
  const pool = await getMarketsForBtcSniper(true);
  const summary = summarizeBtcPool(pool);

  console.log('Discovery sources:');
  console.log('  slug windows:', slugResults.length);
  console.log('  near-term rows:', nearTerm.length);
  console.log('  search rows:', search.length);
  console.log('Merged pool:', JSON.stringify(summary, null, 2));

  const parents = new Map<string, typeof pool>();
  for (const m of pool) {
    const pid = m.parentMarketId ?? m.id;
    if (!parents.has(pid)) parents.set(pid, []);
    parents.get(pid)!.push(m);
  }

  for (const [pid, rows] of parents) {
    if (rows.length < 2) {
      console.warn(`  WARN: parent ${pid} has only ${rows.length} token row(s)`);
    }
  }

  const closes = await fetchBtcUsdtCloses(30, true);
  console.log('\nBinance closes:', closes?.length ?? 0, closes ? `(last=${closes.at(-1)?.toFixed(2)})` : '');

  console.log('\nNext windows:');
  const seen = new Set<string>();
  for (const m of pool.slice(0, 10)) {
    const key = m.parentMarketId ?? m.externalId;
    if (seen.has(key)) continue;
    seen.add(key);
    const up = pool.find((r) => r.parentMarketId === m.parentMarketId && r.outcome === 'Up') ?? m;
    const down = pool.find((r) => r.parentMarketId === m.parentMarketId && r.outcome === 'Down');
    try {
      const upBook = up ? await fetchPolymarketOrderBook(up.externalId) : null;
      const downBook = down ? await fetchPolymarketOrderBook(down.externalId) : null;
      const upPrice = resolveUpPriceFromBooks(upBook?.mid, downBook?.mid);
      const windowMin = m.btcWindowMinutes ?? 5;
      const signal = closes && upPrice != null ? getAdvancedSignal(closes, upPrice, windowMin === 5 ? '5m' : '15m') : null;
      console.log(
        `  ${m.question.slice(0, 65)} | up=${upPrice?.toFixed(3) ?? '?'} signal=${signal ?? 'null'}`,
      );
    } catch (e) {
      console.log(`  ${m.question.slice(0, 65)} | ERROR`, e);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
