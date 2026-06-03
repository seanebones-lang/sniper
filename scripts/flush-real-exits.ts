/**
 * Evaluate exit rules on all live open positions and submit SELL orders where triggered.
 * Run: railway run -- npx tsx scripts/flush-real-exits.ts
 * Dry run: DRY_RUN=1 railway run -- npx tsx scripts/flush-real-exits.ts
 */
import { db, strategies } from '../lib/db';
import { getRealOpenPositionsByStrategy } from '../lib/execution/real-positions';
import {
  fetchPolymarketMarketByTokenId,
  fetchPolymarketOrderBook,
} from '../lib/clients/polymarket';
import { evaluateExitSignal } from '../lib/strategies/exit-engine';
import { resolveStrategyConfigForType } from '../lib/strategies/run-profile';
import type { StrategyConfig } from '../lib/strategies/types';
import { placeRealOrder } from '../lib/execution/real-executor';
import { resolveAskOnlySellLimitPrice } from '../lib/execution/exit-pricing';
import { ensureMarketRecord } from '../lib/markets';

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

async function main() {
  const liveStrategies = await db.query.strategies.findMany({
    where: (s, { and, eq: eqFn }) => and(eqFn(s.isActive, true), eqFn(s.paperOnly, false)),
  });

  if (liveStrategies.length === 0) {
    console.log('No active live strategies.');
    return;
  }

  const ids = liveStrategies.map((s) => s.id);
  const positionsByStrategy = await getRealOpenPositionsByStrategy(ids);

  let submitted = 0;
  let skipped = 0;

  for (const strat of liveStrategies) {
    const config = resolveStrategyConfigForType(strat.type, strat.config as unknown as StrategyConfig);
    const positions = positionsByStrategy.get(strat.id) ?? [];
    console.log(`\n[${strat.name}] ${positions.length} open position(s)`);

    for (const pos of positions) {
      let market =
        pos.platform === 'polymarket'
          ? await fetchPolymarketMarketByTokenId(pos.marketExternalId)
          : null;
      if (!market) {
        market = {
          platform: pos.platform as 'polymarket',
          externalId: pos.marketExternalId,
          question: '',
          status: 'open',
          volume: 0,
          updatedAt: new Date().toISOString(),
        };
      }

      const book =
        pos.platform === 'polymarket'
          ? await fetchPolymarketOrderBook(pos.marketExternalId)
          : null;
      const currentPrice =
        book?.bids?.[0]?.price ?? book?.mid ?? book?.asks?.[0]?.price ?? market.lastPrice;

      if (!currentPrice || currentPrice <= 0) {
        console.log(`  SKIP ${pos.marketExternalId.slice(0, 14)}… — no price`);
        skipped++;
        continue;
      }

      const mult = currentPrice / pos.avgEntryPrice;
      const exit = evaluateExitSignal(
        pos,
        currentPrice,
        book?.spread,
        book?.mid ?? currentPrice,
        config,
        Date.now(),
        market.endDate,
      );

      const label = market.question?.slice(0, 55) || pos.marketExternalId.slice(0, 14);
      console.log(
        `  ${label} | net=${pos.netSize} entry=${pos.avgEntryPrice.toFixed(4)} px=${currentPrice.toFixed(4)} (${mult.toFixed(2)}×) → ${exit ? exit.reason : 'HOLD'}`,
      );

      if (!exit || exit.action !== 'SELL') {
        skipped++;
        continue;
      }

      const sellPrice =
        book?.bids?.[0]?.price ??
        resolveAskOnlySellLimitPrice(book, currentPrice);
      const size = Math.floor(pos.netSize);
      if (size <= 0) {
        skipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`    DRY RUN would SELL ${size} @ ${sellPrice.toFixed(4)} (${book?.bids?.length ? 'bid' : 'limit/ask'})`);
        submitted++;
        continue;
      }

      await ensureMarketRecord(market);
      const result = await placeRealOrder({
        market,
        side: 'SELL',
        price: sellPrice,
        size,
        reason: `[FLUSH] ${exit.reason}`,
        edge: exit.edge,
        confidence: exit.confidence,
        isExit: true,
        book,
        takeLiquidity: (book?.bids?.length ?? 0) > 0,
        maxNotionalUsd: config.maxSizeUsd,
      });

      if (result.success) {
        console.log(`    SELL submitted tradeId=${result.tradeId}`);
        submitted++;
      } else {
        console.log(`    SELL failed: ${result.error}`);
        skipped++;
      }
    }
  }

  console.log(`\nDone: ${submitted} exit(s) ${DRY_RUN ? 'would be ' : ''}submitted, ${skipped} held/skipped`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
