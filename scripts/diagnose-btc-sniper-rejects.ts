/**
 * Why zero BTC sniper entries? Count each rejection layer.
 */
import { getMarketsForBtcSniper } from '../lib/markets';
import { fetchBtcUsdtCloses } from '../lib/clients/ccxt-binance';
import {
  computeMomentumPct,
  getAdvancedSignal,
  resolveUpPriceFromBooks,
} from '../lib/btc/signal-engine';
import { rsiLast } from '../lib/indicators/rsi';
import { fetchPolymarketOrderBook } from '../lib/clients/polymarket';
import { assessFastMovingMarket } from '../lib/markets/fast-moving';
import { checkLiveEntryGates } from '../lib/execution/live-entry-gates';
import { resolveStrategyConfigForType } from '../lib/strategies/run-profile';
import { evaluateBtcSniper, setBtcSniperBookCache } from '../lib/strategies/btc-sniper';
import { CycleBookCache } from '../lib/runner/book-cache';

async function main() {
  const pool = await getMarketsForBtcSniper(true);
  const closes = await fetchBtcUsdtCloses(30, true);
  const rsi = closes ? rsiLast(closes, 7) : null;
  const mom = closes ? computeMomentumPct(closes, 5) : null;

  console.log('=== BINANCE (signal source) ===');
  console.log('RSI(7):', rsi?.toFixed(2), '— need <35 (buy up) or >65 (buy down)');
  console.log('Momentum 5-bar %:', mom?.toFixed(4), '— need >0.4 (up) or <-0.4 (down)');
  console.log('');

  const config = resolveStrategyConfigForType('btc-sniper', {
    maxSizeUsd: 1,
    targetProfitPct: 12,
    cooldownSeconds: 10,
    tradingGoal: 'btc-momentum',
  } as never);

  const parents = new Map<string, { up: (typeof pool)[0]; down: (typeof pool)[0]; q: string }>();
  for (const m of pool) {
    const pid = m.parentMarketId ?? m.id;
    if (!parents.has(pid)) parents.set(pid, { up: m, down: m, q: m.question });
    const row = parents.get(pid)!;
    if (m.outcome === 'Up') row.up = m;
    if (m.outcome === 'Down') row.down = m;
  }

  const counts: Record<string, number> = {};
  const bump = (k: string) => {
    counts[k] = (counts[k] ?? 0) + 1;
  };

  const bookCache = new CycleBookCache();
  const toFetch: Array<{ platform: string; externalId: string }> = [];
  for (const { up, down } of parents.values()) {
    toFetch.push({ platform: up.platform, externalId: up.externalId });
    toFetch.push({ platform: down.platform, externalId: down.externalId });
  }
  await bookCache.fetchBooks(toFetch);
  setBtcSniperBookCache(bookCache);

  for (const [, { up, down, q }] of parents) {
    if (!up?.externalId || !down?.externalId || up.externalId === down.externalId) {
      bump('missing_dual_token');
      continue;
    }

    const upBook = bookCache.getBook(up.platform, up.externalId);
    const downBook = bookCache.getBook(down.platform, down.externalId);
    if (!upBook?.asks?.length || !downBook?.asks?.length) {
      bump('no_asks');
      continue;
    }

    const upPrice = resolveUpPriceFromBooks(upBook.mid ?? upBook.asks[0].price, downBook.mid);
    if (upPrice == null) {
      bump('no_up_price');
      continue;
    }

    const signal = closes ? getAdvancedSignal(closes, upPrice, '5m') : null;
    if (!signal) bump('signal_null_rsi_mom_or_price');

    const assess = assessFastMovingMarket(up);
    console.log('---', q.slice(0, 65));
    console.log('  upMid:', upPrice.toFixed(3), '| signal:', signal ?? 'null');
    console.log('  up ask/bid:', upBook.asks[0].price.toFixed(3), '/', (upBook.bids[0]?.price ?? 0).toFixed(3));
    console.log('  fastMoving:', assess.kind, 'score:', assess.score);

    for (const row of [up, down]) {
      const book = row.outcome === 'Up' ? upBook : downBook;
      const sig = await evaluateBtcSniper({ market: row, book, currentPrice: book.mid }, config);
      if (sig) {
        bump('strategy_would_buy');
        console.log('  >>> WOULD BUY', row.outcome, sig.reason);
        const ask = book.asks[0].price;
        const bid = book.bids[0]?.price ?? 0;
        const gate = await checkLiveEntryGates({
          market: row,
          book,
          config,
          ask,
          bid,
          stakeUsd: 1,
          targetMultiple: 1.12,
          strategyType: 'btc-sniper',
        });
        if (!gate.allowed) {
          bump(`gate_${gate.code}`);
          console.log('  GATE BLOCK:', gate.code, gate.reason);
        } else {
          bump('gate_pass');
        }
      } else {
        bump(`eval_null_${row.outcome}`);
      }
    }
  }

  console.log('\n=== REJECTION COUNTS ===');
  console.log(JSON.stringify(counts, null, 2));
  console.log('\nMost likely block: signal_null = RSI/momentum/price combo never fires together.');
  console.log('Cheap odds alone is NOT enough — need RSI<35 AND mom>0.4 AND up<0.50 (or mirror for down).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
