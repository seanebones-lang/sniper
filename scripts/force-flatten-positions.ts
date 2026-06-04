/**
 * Force-exit ALL live open positions — bypasses exit-engine HOLD rules.
 * Cancels stuck CLOB SELLs first, then posts bid-cross or minimum-tick limit.
 *
 * Run:  cd /Users/nexteleven/sniper/sniper && railway run --service sniper -- npx tsx scripts/force-flatten-positions.ts
 * Dry:  DRY_RUN=1 railway run --service sniper -- npx tsx scripts/force-flatten-positions.ts
 */
import { db, realTrades, strategies } from '../lib/db';
import { eq, and, inArray } from 'drizzle-orm';
import { getRealOpenPositionsByStrategy } from '../lib/execution/real-positions';
import {
  fetchPolymarketMarketByTokenId,
  fetchPolymarketOrderBook,
} from '../lib/clients/polymarket';
import {
  getPolymarketPrivateKey,
  cancelPolymarketOrder,
  getPolymarketOpenOrders,
  getPolymarketTokenBalance,
  isValidPolymarketOrderId,
} from '../lib/clients/polymarket-trading';
import { resolveAskOnlySellLimitPrice } from '../lib/execution/exit-pricing';
import { placeRealOrder } from '../lib/execution/real-executor';
import { writeOffGhostLedgerPosition } from '../lib/execution/ledger-writeoff';
import { ensureMarketRecord } from '../lib/markets';

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const MIN_LIMIT_PRICE = 0.01;

async function cancelOpenSellsOnMarket(privateKey: string, tokenId: string): Promise<number> {
  const open = await getPolymarketOpenOrders(privateKey);
  let cancelled = 0;
  for (const o of open) {
    const row = o as Record<string, unknown>;
    const assetId = String(row.asset_id ?? row.token_id ?? row.assetId ?? '');
    const side = String(row.side ?? '').toUpperCase();
    if (assetId !== tokenId || side !== 'SELL') continue;
    const orderId = String(row.id ?? row.orderID ?? row.order_id ?? '');
    if (!isValidPolymarketOrderId(orderId)) continue;
    if (!DRY_RUN) {
      const ok = await cancelPolymarketOrder(privateKey, orderId);
      if (!ok) console.log(`    WARN cancel failed for ${orderId.slice(0, 12)}…`);
    }
    console.log(`    cancelled CLOB SELL ${orderId.slice(0, 12)}…`);
    cancelled++;
  }
  return cancelled;
}

async function cancelAllOpenOrders(privateKey: string): Promise<number> {
  const open = await getPolymarketOpenOrders(privateKey);
  let cancelled = 0;
  for (const o of open) {
    const row = o as Record<string, unknown>;
    const orderId = String(row.id ?? row.orderID ?? row.order_id ?? '');
    if (!isValidPolymarketOrderId(orderId)) continue;
    if (!DRY_RUN) await cancelPolymarketOrder(privateKey, orderId);
    cancelled++;
  }
  if (cancelled > 0) console.log(`Cancelled ${cancelled} open order(s) globally`);
  return cancelled;
}

async function cancelDbPendingSells(tokenId: string): Promise<number> {
  const rows = await db.query.realTrades.findMany({
    where: and(
      eq(realTrades.platform, 'polymarket'),
      eq(realTrades.marketExternalId, tokenId),
      eq(realTrades.side, 'SELL'),
      inArray(realTrades.status, ['pending', 'needs_review']),
    ),
    limit: 20,
  });
  if (!DRY_RUN) {
    for (const row of rows) {
      await db.update(realTrades).set({ status: 'cancelled' }).where(eq(realTrades.id, row.id));
    }
  }
  return rows.length;
}

async function main() {
  const privateKey = getPolymarketPrivateKey();
  if (!privateKey) {
    console.error('POLYMARKET_PRIVATE_KEY not set');
    process.exit(1);
  }

  const liveStrategies = await db.query.strategies.findMany({
    where: (s, { and: a, eq: e }) => a(e(s.isActive, true), e(s.paperOnly, false)),
  });
  if (liveStrategies.length === 0) {
    console.log('No active live strategies.');
    return;
  }

  const ids = liveStrategies.map((s) => s.id);
  const positionsByStrategy = await getRealOpenPositionsByStrategy(ids);

  let submitted = 0;
  let skipped = 0;

  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== FORCE FLATTEN ===');

  if (!DRY_RUN) await cancelAllOpenOrders(privateKey);

  for (const strat of liveStrategies) {
    const positions = positionsByStrategy.get(strat.id) ?? [];
    console.log(`\n[${strat.name}] ${positions.length} position(s)`);

    for (const pos of positions) {
      if (pos.platform !== 'polymarket') {
        console.log(`  SKIP non-polymarket ${pos.marketExternalId.slice(0, 14)}…`);
        skipped++;
        continue;
      }

      const tokenId = pos.marketExternalId;
      let market = await fetchPolymarketMarketByTokenId(tokenId);
      if (!market) {
        market = {
          platform: 'polymarket',
          externalId: tokenId,
          question: '',
          status: 'open',
          volume: 0,
          updatedAt: new Date().toISOString(),
        };
      }

      const label = market.question?.slice(0, 55) || tokenId.slice(0, 14);
      console.log(`\n  ${label}`);
      console.log(`    token ${tokenId.slice(0, 20)}… ledger=${pos.netSize} entry=${pos.avgEntryPrice}`);

      const clobCancelled = await cancelOpenSellsOnMarket(privateKey, tokenId);
      const dbCancelled = await cancelDbPendingSells(tokenId);
      if (clobCancelled + dbCancelled > 0) {
        console.log(`    cleared ${clobCancelled} CLOB + ${dbCancelled} DB pending SELL(s)`);
      }

      const onChain = await getPolymarketTokenBalance(privateKey, tokenId);
      const size = Math.floor(onChain ?? pos.netSize);
      console.log(`    on-chain=${onChain ?? '?'} sellSize=${size}`);

      if (size <= 0) {
        console.log('    SKIP — no on-chain balance (ledger ghost)');
        if (!DRY_RUN && pos.netSize > 0.05) {
          await writeOffGhostLedgerPosition(
            tokenId,
            pos.netSize,
            pos.avgEntryPrice,
            'force-flatten on-chain flat',
          );
          console.log(`    wrote off ledger ${pos.netSize} shares`);
        }
        skipped++;
        continue;
      }

      const book = await fetchPolymarketOrderBook(tokenId);
      const hasBids = (book?.bids?.length ?? 0) > 0 && (book?.bids?.[0]?.size ?? 0) > 0;
      const hasAsks = (book?.asks?.length ?? 0) > 0;
      const refPrice =
        book?.bids?.[0]?.price ??
        book?.asks?.[0]?.price ??
        book?.mid ??
        pos.avgEntryPrice;
      const sellPrice = hasBids
        ? book!.bids![0].price
        : hasAsks
          ? resolveAskOnlySellLimitPrice(book, refPrice)
          : MIN_LIMIT_PRICE;

      console.log(
        `    book: bids=${book?.bids?.length ?? 0} asks=${book?.asks?.length ?? 0} → SELL ${size} @ ${sellPrice.toFixed(4)} (${hasBids ? 'cross bid' : 'limit'})`,
      );

      if (DRY_RUN) {
        submitted++;
        continue;
      }

      await ensureMarketRecord(market);
      const result = await placeRealOrder({
        market,
        side: 'SELL',
        price: sellPrice,
        size,
        reason: '[FORCE-FLATTEN] legacy position unwind',
        isExit: true,
        book,
        takeLiquidity: hasBids,
        maxNotionalUsd: size * sellPrice,
      });

      if (result.success) {
        console.log(`    OK tradeId=${result.tradeId}`);
        submitted++;
      } else {
        console.log(`    FAILED: ${result.error}`);
        skipped++;
      }
    }
  }

  console.log(`\nDone: ${submitted} SELL(s) ${DRY_RUN ? 'would submit' : 'submitted'}, ${skipped} skipped`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
