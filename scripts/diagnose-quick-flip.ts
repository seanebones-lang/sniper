import { getMarketsForQuickFlip } from '../lib/markets';
import {
  filterQuickFlipMarkets,
  QUICK_FLIP_MAX_RESOLUTION_HOURS,
  hoursUntilResolution,
} from '../lib/markets/fast-moving';
import { fetchPolymarketLiveSportsMarkets } from '../lib/clients/polymarket';
import { LiveQuickFlip } from '../lib/strategies/live-quick-flip';
import { resolveStrategyConfig } from '../lib/strategies/run-profile';
import { fetchPolymarketOrderBook } from '../lib/clients/polymarket';

async function main() {
  const all = await getMarketsForQuickFlip(true);
  const liveSports = await fetchPolymarketLiveSportsMarkets();
  const eligible = filterQuickFlipMarkets(all);

  console.log('Pool:', all.length, '| live sports search:', liveSports.length);
  console.log('With endDate:', all.filter((m) => m.endDate).length);
  console.log(`Eligible (≤${QUICK_FLIP_MAX_RESOLUTION_HOURS}h):`, eligible.length);

  if (eligible.length === 0) {
    const withEnd = all
      .filter((m) => m.endDate)
      .sort((a, b) => (hoursUntilResolution(a) ?? 999) - (hoursUntilResolution(b) ?? 999));
    console.log('\nSoonest 10 end dates in pool:');
    for (const m of withEnd.slice(0, 10)) {
      console.log(`  ${hoursUntilResolution(m)?.toFixed(1)}h | ${m.question.slice(0, 70)}`);
    }
    return;
  }

  const config = resolveStrategyConfig({
    maxSizeUsd: 1,
    targetProfitPct: 150,
    cooldownSeconds: 15,
    tradingGoal: 'quick-flip',
    tradingStyle: 'aggressive',
    liveMarketsOnly: true,
    targetProfitMultiple: 2.5,
  });

  console.log('\nTesting strategy on first 5 eligible markets:');
  for (const market of eligible.slice(0, 5)) {
    const h = hoursUntilResolution(market);
    try {
      const book = await fetchPolymarketOrderBook(market.externalId);
      const signal = LiveQuickFlip.evaluate(
        { market, book, currentPrice: book.mid ?? market.lastPrice },
        config,
      );
      console.log(
        `  ${h?.toFixed(2)}h | signal=${signal?.action ?? 'null'} | ${market.question.slice(0, 55)}`,
      );
      if (!signal) {
        const ask = book.asks[0]?.price;
        const bid = book.bids[0]?.price;
        console.log(`       book bid=${bid?.toFixed(3)} ask=${ask?.toFixed(3)} bids=${book.bids.length} asks=${book.asks.length}`);
      }
    } catch (e) {
      console.log(`  ${h?.toFixed(2)}h | ERROR | ${market.question.slice(0, 55)} |`, e);
    }
  }
}

main().catch(console.error);
