/**
 * Autonomous recovery for 24/7 live micro trading — no manual scripts required.
 *
 * Runs on a throttle from the runner (pre-cycle) when real execution is enabled.
 * Fixes: ghost ledgers, dust, dead books, stale pending orders, rejected-exit storms.
 */
import { db, auditEvents, realTrades } from '@/lib/db';
import { and, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import { getRealOpenPositionsForHeal } from '@/lib/execution/real-positions';
import { writeOffGhostLedgerPosition } from '@/lib/execution/ledger-writeoff';
import {
  hydrateRuntimeDeadMarketTokens,
  isDeadMarketToken,
  isDustOpenPosition,
  isLegacyPennyPosition,
  markRuntimeDeadMarketToken,
} from '@/lib/execution/dead-market-tokens';
import { fetchPolymarketOrderBook } from '@/lib/clients/polymarket';
import { getPolymarketPrivateKey, getPolymarketTokenBalance } from '@/lib/clients/polymarket-trading';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const STALE_BUY_MS = 25 * 60 * 1000;
const STALE_SELL_MS = 50 * 60 * 1000;
const REJECT_STORM_WINDOW_MS = 60 * 60 * 1000;
const REJECT_STORM_MIN = 6;

let lastHealAt = 0;
let hydratedDead = false;

export interface LiveSelfHealResult {
  ran: boolean;
  ghostWriteOffs: number;
  dustWriteOffs: number;
  deadWriteOffs: number;
  deadBooksMarked: number;
  stalePendingCancelled: number;
  rejectStormsCleared: number;
}

async function logRecentRejectPatterns(): Promise<void> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await db.query.realTrades.findMany({
    where: and(eq(realTrades.status, 'rejected'), gte(realTrades.createdAt, since)),
    orderBy: [desc(realTrades.createdAt)],
    limit: 15,
    columns: { side: true },
  });

  const bySide = { BUY: 0, SELL: 0 };
  for (const r of recent) {
    if (r.side === 'BUY' || r.side === 'SELL') bySide[r.side]++;
  }
  if (recent.length > 0) {
    console.log(
      `[LiveSelfHeal] Last hour: ${recent.length} rejected trades (BUY=${bySide.BUY} SELL=${bySide.SELL})`,
    );
  }

  const auditBlocks = await db.query.auditEvents.findMany({
    orderBy: [desc(auditEvents.createdAt)],
    limit: 100,
    columns: { action: true, createdAt: true },
  });
  const counts = new Map<string, number>();
  for (const row of auditBlocks) {
    if (row.createdAt < since) continue;
    if (
      !row.action.includes('blocked') &&
      !row.action.includes('skipped') &&
      row.action !== 'real_order_result'
    ) {
      continue;
    }
    counts.set(row.action, (counts.get(row.action) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (top.length > 0) {
    console.log(`[LiveSelfHeal] Top blocks: ${top.map(([k, n]) => `${k}=${n}`).join(', ')}`);
  }
}

async function logHeal(action: string, payload: Record<string, unknown>) {
  try {
    await db.insert(auditEvents).values({ actor: 'live-self-heal', action, payload });
  } catch {
    // best effort
  }
}

function emptyResult(ran: boolean): LiveSelfHealResult {
  return {
    ran,
    ghostWriteOffs: 0,
    dustWriteOffs: 0,
    deadWriteOffs: 0,
    deadBooksMarked: 0,
    stalePendingCancelled: 0,
    rejectStormsCleared: 0,
  };
}

async function healStalePendingOrders(): Promise<number> {
  const now = Date.now();
  let cancelled = 0;

  const staleBuys = await db.query.realTrades.findMany({
    where: and(
      eq(realTrades.status, 'pending'),
      eq(realTrades.side, 'BUY'),
      lt(realTrades.createdAt, new Date(now - STALE_BUY_MS)),
    ),
    limit: 30,
  });
  for (const row of staleBuys) {
    await db.update(realTrades).set({ status: 'cancelled' }).where(eq(realTrades.id, row.id));
    cancelled++;
  }

  const staleSells = await db.query.realTrades.findMany({
    where: and(
      eq(realTrades.status, 'pending'),
      eq(realTrades.side, 'SELL'),
      lt(realTrades.createdAt, new Date(now - STALE_SELL_MS)),
    ),
    limit: 30,
  });
  for (const row of staleSells) {
    await db.update(realTrades).set({ status: 'cancelled' }).where(eq(realTrades.id, row.id));
    cancelled++;
  }

  return cancelled;
}

async function findHealPosition(
  liveStrategyIds: string[],
  tokenId: string,
): Promise<{ netSize: number; avgEntryPrice: number } | null> {
  const byStrat = await getRealOpenPositionsForHeal(liveStrategyIds);
  for (const positions of byStrat.values()) {
    const p = positions.find((x) => x.marketExternalId === tokenId);
    if (p) return { netSize: p.netSize, avgEntryPrice: p.avgEntryPrice };
  }
  return null;
}

async function healRejectedSellStorms(
  pk: string,
  liveStrategyIds: string[],
  result: LiveSelfHealResult,
): Promise<void> {
  const since = new Date(Date.now() - REJECT_STORM_WINDOW_MS);
  const rejected = await db.query.realTrades.findMany({
    where: and(
      eq(realTrades.platform, 'polymarket'),
      eq(realTrades.side, 'SELL'),
      eq(realTrades.status, 'rejected'),
      gte(realTrades.createdAt, since),
    ),
    columns: { marketExternalId: true },
    limit: 200,
  });

  const counts = new Map<string, number>();
  for (const r of rejected) {
    counts.set(r.marketExternalId, (counts.get(r.marketExternalId) ?? 0) + 1);
  }

  for (const [tokenId, count] of counts) {
    if (count < REJECT_STORM_MIN) continue;
    const onChain = (await getPolymarketTokenBalance(pk, tokenId)) ?? 0;
    if (onChain < 0.05) {
      const pos = await findHealPosition(liveStrategyIds, tokenId);
      if (pos && pos.netSize > 0.05) {
        await writeOffGhostLedgerPosition(
          tokenId,
          pos.netSize,
          pos.avgEntryPrice,
          `reject storm (${count}) on-chain flat`,
        );
        result.rejectStormsCleared++;
      }
      await logHeal('reject_storm_writeoff', { tokenId: tokenId.slice(0, 20), count, onChain });
      continue;
    }
    const cancelled = await import('@/lib/execution/ledger-writeoff').then((m) =>
      m.cancelPendingRealTradesOnToken(tokenId),
    );
    result.stalePendingCancelled += cancelled;
    await markRuntimeDeadMarketToken(tokenId, `reject storm (${count} SELL rejects/h)`);
    result.deadBooksMarked++;
    await logHeal('reject_storm_mark_dead', { tokenId: tokenId.slice(0, 20), count, onChain });
  }
}

function isEmptyBook(book: Awaited<ReturnType<typeof fetchPolymarketOrderBook>>): boolean {
  const bidSz = book?.bids?.[0]?.size ?? 0;
  const askSz = book?.asks?.[0]?.size ?? 0;
  return bidSz <= 0 && askSz <= 0;
}

async function healLedgerVsOnChain(
  pk: string,
  liveStrategyIds: string[],
  result: LiveSelfHealResult,
): Promise<void> {
  const byStrat = await getRealOpenPositionsForHeal(liveStrategyIds);

  for (const positions of byStrat.values()) {
    for (const pos of positions) {
      const tokenId = pos.marketExternalId;
      const onChain = (await getPolymarketTokenBalance(pk, tokenId)) ?? 0;

      if (isDeadMarketToken(tokenId)) {
        await writeOffGhostLedgerPosition(tokenId, pos.netSize, pos.avgEntryPrice, 'dead market ledger');
        result.deadWriteOffs++;
        continue;
      }

      if (isDustOpenPosition(pos.netSize, pos.avgEntryPrice)) {
        await writeOffGhostLedgerPosition(tokenId, pos.netSize, pos.avgEntryPrice, 'dust residue');
        result.dustWriteOffs++;
        continue;
      }

      if (isLegacyPennyPosition(pos.avgEntryPrice, pos.netSize)) {
        await writeOffGhostLedgerPosition(tokenId, pos.netSize, pos.avgEntryPrice, 'legacy penny lot');
        result.ghostWriteOffs++;
        continue;
      }

      if (onChain < 0.05 && pos.netSize > 0.1) {
        await writeOffGhostLedgerPosition(tokenId, pos.netSize, pos.avgEntryPrice, 'on-chain flat');
        result.ghostWriteOffs++;
        await logHeal('ghost_writeoff', { tokenId: tokenId.slice(0, 20), ledger: pos.netSize, onChain });
        continue;
      }

      if (onChain > 0 && pos.netSize - onChain > 0.5) {
        const excess = pos.netSize - onChain;
        await writeOffGhostLedgerPosition(tokenId, excess, pos.avgEntryPrice, 'ledger > on-chain');
        result.ghostWriteOffs++;
        continue;
      }

      if (pos.netSize < 1 && onChain < 1 && pos.netSize > 0.01 && onChain < pos.netSize * 0.5) {
        await writeOffGhostLedgerPosition(
          tokenId,
          pos.netSize,
          pos.avgEntryPrice,
          'partial-exit residue (<1 share)',
        );
        result.dustWriteOffs++;
        continue;
      }

      if (onChain > 0.05) {
        const book = await fetchPolymarketOrderBook(tokenId);
        if (isEmptyBook(book)) {
          const marked = await markRuntimeDeadMarketToken(tokenId, 'empty CLOB book');
          if (marked) {
            result.deadBooksMarked++;
            await writeOffGhostLedgerPosition(
              tokenId,
              pos.netSize,
              pos.avgEntryPrice,
              'dead book — ledger cleared (wallet shares may remain)',
            );
            result.deadWriteOffs++;
            await logHeal('dead_book_writeoff', { tokenId: tokenId.slice(0, 20), onChain, ledger: pos.netSize });
          }
        }
      }
    }
  }
}

/**
 * Run autonomous live recovery. Throttled unless `force` is true.
 */
export async function runLiveSelfHeal(options?: {
  force?: boolean;
  intervalMs?: number;
}): Promise<LiveSelfHealResult> {
  if (process.env.SNIPER_ENABLE_REAL_EXECUTION !== 'true') {
    return emptyResult(false);
  }

  const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
  const now = Date.now();
  if (!options?.force && now - lastHealAt < intervalMs) {
    return emptyResult(false);
  }
  lastHealAt = now;

  if (!hydratedDead) {
    await hydrateRuntimeDeadMarketTokens();
    hydratedDead = true;
  }

  const pk = getPolymarketPrivateKey();
  if (!pk) return emptyResult(true);

  const live = await db.query.strategies.findMany({
    where: (s, { and: a, eq: e }) => a(e(s.isActive, true), e(s.paperOnly, false)),
    columns: { id: true, name: true },
  });
  if (live.length === 0) return emptyResult(true);

  const liveIds = live.map((s) => s.id);
  const result = emptyResult(true);

  result.stalePendingCancelled = await healStalePendingOrders();
  await healLedgerVsOnChain(pk, liveIds, result);
  await healRejectedSellStorms(pk, liveIds, result);

  const total =
    result.ghostWriteOffs +
    result.dustWriteOffs +
    result.deadWriteOffs +
    result.deadBooksMarked +
    result.stalePendingCancelled +
    result.rejectStormsCleared;

  await logRecentRejectPatterns();

  if (total > 0) {
    console.log(
      `[LiveSelfHeal] ghost=${result.ghostWriteOffs} dust=${result.dustWriteOffs} dead=${result.deadWriteOffs} ` +
        `markedDead=${result.deadBooksMarked} staleCancelled=${result.stalePendingCancelled} ` +
        `rejectStorms=${result.rejectStormsCleared}`,
    );
    try {
      const { persistSystemState } = await import('@/lib/monitoring/system-state');
      const { getRuntimeDeadMarketTokens } = await import('@/lib/execution/dead-market-tokens');
      await persistSystemState(
        'live_self_heal',
        {
          runtimeDeadTokens: getRuntimeDeadMarketTokens(),
          lastHealAt: new Date().toISOString(),
          lastSummary: result,
        },
        'autonomous heal cycle',
      );
    } catch {
      // best effort
    }
    await logHeal('heal_cycle_complete', result as unknown as Record<string, unknown>);
  }

  return result;
}
