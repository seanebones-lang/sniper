/**
 * Why is the runner finding 0 quick-flip entries? Count rejection reasons on live pool.
 */
import { getMarketsForQuickFlip } from '../lib/markets';
import {
  assessFastMovingMarket,
  filterQuickFlipMarkets,
  hoursUntilResolution,
  isQuickFlipCandidate,
  QUICK_FLIP_MAX_RESOLUTION_HOURS,
  rankQuickFlipMarkets,
} from '../lib/markets/fast-moving';
import { fetchPolymarketOrderBook } from '../lib/clients/polymarket';
import {
  LIVE_QUICK_FLIP_MAX_ENTRY_PRICE,
  LIVE_QUICK_FLIP_MAX_SPREAD_PCT,
  LIVE_QUICK_FLIP_MIN_BID_NOTIONAL_RATIO,
  LIVE_QUICK_FLIP_MIN_ENTRY_PRICE,
  LIVE_QUICK_FLIP_MIN_MARKET_SCORE,
} from '../lib/strategies/run-profile';

const STAKE = 1;
const SAMPLE = 40;

function bump(counts: Record<string, number>, key: string) {
  counts[key] = (counts[key] ?? 0) + 1;
}

async function main() {
  const open = await getMarketsForQuickFlip(true);
  const eligible = filterQuickFlipMarkets(open);
  const sample = rankQuickFlipMarkets(eligible).slice(0, SAMPLE);

  const counts: Record<string, number> = {};
  const nearMisses: string[] = [];

  bump(counts, `pool_open_${open.length}`);
  bump(counts, `eligible_${QUICK_FLIP_MAX_RESOLUTION_HOURS}h_${eligible.length}`);

  for (const m of sample) {
    const hrs = hoursUntilResolution(m);
    if (!isQuickFlipCandidate(m)) {
      bump(counts, 'not_candidate');
      continue;
    }

    let book;
    try {
      book = await fetchPolymarketOrderBook(m.externalId);
    } catch {
      bump(counts, 'book_fetch_fail');
      continue;
    }

    if (!book.asks?.length) {
      bump(counts, 'no_asks');
      continue;
    }

    const ask = book.asks[0].price;
    const askSize = book.asks[0].size;
    const bid = book.bids?.[0]?.price ?? 0;
    const bidSize = book.bids?.[0]?.size ?? 0;

    if (ask < LIVE_QUICK_FLIP_MIN_ENTRY_PRICE) {
      bump(counts, `ask_below_min_${LIVE_QUICK_FLIP_MIN_ENTRY_PRICE}`);
      continue;
    }
    if (ask > LIVE_QUICK_FLIP_MAX_ENTRY_PRICE) {
      bump(counts, `ask_above_max_${LIVE_QUICK_FLIP_MAX_ENTRY_PRICE}`);
      if (nearMisses.length < 5) {
        nearMisses.push(`high_ask ${ask.toFixed(2)} ${m.question.slice(0, 50)} (${hrs?.toFixed(1)}h)`);
      }
      continue;
    }
    if (askSize < 1) {
      bump(counts, 'thin_ask');
      continue;
    }

    const shares = Math.max(1, Math.ceil(STAKE / ask));
    if (bid <= 0 || bidSize < shares) {
      bump(counts, 'bid_depth');
      if (nearMisses.length < 8) {
        nearMisses.push(`bid_depth bid=${bid.toFixed(3)}×${bidSize.toFixed(0)} ${m.question.slice(0, 45)}`);
      }
      continue;
    }
    if (bid * bidSize < STAKE * LIVE_QUICK_FLIP_MIN_BID_NOTIONAL_RATIO) {
      bump(counts, 'bid_notional');
      continue;
    }

    const mid = book.mid ?? (ask + bid) / 2;
    const spread = book.spread ?? ask - bid;
    if (mid > 0 && (spread / mid) * 100 > LIVE_QUICK_FLIP_MAX_SPREAD_PCT) {
      bump(counts, `spread_gt_${LIVE_QUICK_FLIP_MAX_SPREAD_PCT}pct`);
      if (nearMisses.length < 10) {
        nearMisses.push(`spread ${((spread / mid) * 100).toFixed(0)}% ask=${ask.toFixed(2)} ${m.question.slice(0, 40)}`);
      }
      continue;
    }

    const score = assessFastMovingMarket(m).score;
    if (score < LIVE_QUICK_FLIP_MIN_MARKET_SCORE) {
      bump(counts, `score_lt_${LIVE_QUICK_FLIP_MIN_MARKET_SCORE}`);
      if (nearMisses.length < 12) {
        nearMisses.push(`score ${score} ask=${ask.toFixed(2)} ${m.question.slice(0, 45)}`);
      }
      continue;
    }

    bump(counts, 'WOULD_SIGNAL');
    nearMisses.unshift(`✓ PASS ask=${ask.toFixed(3)} score=${score} ${m.question.slice(0, 55)}`);
  }

  console.log('=== QUICK FLIP REJECT DIAGNOSTIC ===');
  console.log(JSON.stringify(counts, null, 2));
  console.log('\n=== NEAR MISSES / PASSES ===');
  for (const line of nearMisses.slice(0, 12)) console.log(line);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
