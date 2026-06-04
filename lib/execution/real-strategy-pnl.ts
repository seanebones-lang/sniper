/**
 * Per-strategy PnL and round-trip attribution from filled real_trades.
 */
import { db, realTrades, signals, markets } from '@/lib/db';
import { chunkArray } from '@/lib/db/chunk-in-array';
import { and, eq, gte, inArray } from 'drizzle-orm';
import { assessFastMovingMarket } from '@/lib/markets/fast-moving';
import type { StrategyPnlStats } from '@/lib/paper/strategy-pnl';

export type RealRoundTrip = {
  strategyId: string | null;
  marketExternalId: string;
  platform: string;
  kind: string;
  pnlUsd: number;
  holdMs: number;
  buyCount: number;
  sellCount: number;
  openedAt: Date;
  closedAt: Date;
  avgEntry: number;
  avgExit: number;
};

export type LiveAttributionSummary = {
  windowHours: number;
  roundTrips: number;
  wins: number;
  losses: number;
  breakeven: number;
  totalPnlUsd: number;
  avgPnlPerTripUsd: number;
  winRatePct: number;
  byKind: Record<string, { trips: number; pnlUsd: number; wins: number; losses: number }>;
  recentTrips: RealRoundTrip[];
  sportsLiveWinRatePct: number | null;
};

type LedgerEvent = {
  strategyId: string | null;
  platform: string;
  marketExternalId: string;
  side: string;
  size: number;
  price: number;
  fee: number;
  at: Date;
};

/** Per-strategy PnL from real fills linked via signalId (average-cost on SELL). */
export async function computeRealStrategyPnlWindows(
  strategyIds: string[],
  windowHours = 6,
): Promise<Map<string, StrategyPnlStats>> {
  const since = new Date(Date.now() - windowHours * 3600 * 1000);
  const stats = new Map<string, StrategyPnlStats>();
  for (const id of strategyIds) {
    stats.set(id, { strategyId: id, signals: 0, fills: 0, estimatedPnl: 0, avgSlippage: 0 });
  }
  if (strategyIds.length === 0) return stats;

  const stratSignals = await db.query.signals.findMany({
    where: and(inArray(signals.strategyId, strategyIds), gte(signals.createdAt, since)),
    columns: { id: true, strategyId: true },
  });
  const signalToStrategy = Object.fromEntries(stratSignals.map((s) => [s.id, s.strategyId]));
  for (const sig of stratSignals) {
    const row = stats.get(sig.strategyId);
    if (row) row.signals++;
  }

  const signalIds = stratSignals.map((s) => s.id);
  const fills: Array<{
    signalId: string | null;
    platform: string;
    marketExternalId: string;
    side: string;
    size: string;
    price: string;
    fee: string | null;
    filledAt: Date | null;
    createdAt: Date;
  }> = [];

  for (const ids of chunkArray(signalIds)) {
    if (ids.length === 0) continue;
    const batch = await db.query.realTrades.findMany({
      where: and(
        inArray(realTrades.signalId, ids),
        eq(realTrades.status, 'filled'),
        gte(realTrades.filledAt, since),
      ),
      orderBy: (t, { asc }) => [asc(t.filledAt)],
    });
    fills.push(...batch);
  }

  const posByStrategyMarket = new Map<string, { net: number; cost: number }>();

  for (const fill of fills) {
    const strategyId = fill.signalId ? signalToStrategy[fill.signalId] : null;
    if (!strategyId) continue;
    const row = stats.get(strategyId)!;
    row.fills++;

    const size = parseFloat(fill.size);
    const price = parseFloat(fill.price);
    const fee = parseFloat(fill.fee ?? '0');
    const posKey = `${strategyId}:${fill.platform}:${fill.marketExternalId}`;
    const pos = posByStrategyMarket.get(posKey) ?? { net: 0, cost: 0 };

    if (fill.side === 'BUY') {
      pos.net += size;
      pos.cost += size * price + fee;
    } else {
      const avg = pos.net > 0.01 ? pos.cost / pos.net : price;
      row.estimatedPnl += (price - avg) * size - fee;
      pos.net -= size;
      pos.cost -= avg * size;
      if (pos.net <= 0.01) {
        pos.net = 0;
        pos.cost = 0;
      }
    }
    posByStrategyMarket.set(posKey, pos);
  }

  return stats;
}

function buildEventsFromFills(
  fills: Array<{
    signalId: string | null;
    platform: string;
    marketExternalId: string;
    side: string;
    size: string;
    price: string;
    fee: string | null;
    filledAt: Date | null;
    createdAt: Date;
  }>,
  signalToStrategy: Record<string, string>,
): LedgerEvent[] {
  return fills
    .map((f) => ({
      strategyId: f.signalId ? signalToStrategy[f.signalId] ?? null : null,
      platform: f.platform,
      marketExternalId: f.marketExternalId,
      side: f.side,
      size: parseFloat(f.size),
      price: parseFloat(f.price),
      fee: parseFloat(f.fee ?? '0'),
      at: f.filledAt ?? f.createdAt,
    }))
    .filter((e) => Number.isFinite(e.size) && Number.isFinite(e.price))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

async function loadMarketQuestionsByExternalIds(
  externalIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(externalIds)];
  for (const ids of chunkArray(unique)) {
    if (ids.length === 0) continue;
    const rows = await db.query.markets.findMany({
      where: inArray(markets.externalId, ids),
      columns: { externalId: true, question: true },
    });
    for (const r of rows) map.set(r.externalId, r.question);
  }
  return map;
}

/** Closed round-trips per market (FIFO), with fast-moving kind labels. */
export function roundTripsFromEvents(
  events: LedgerEvent[],
  marketQuestions?: Map<string, string>,
): RealRoundTrip[] {
  const byMarket = new Map<string, LedgerEvent[]>();
  for (const e of events) {
    const key = `${e.strategyId ?? 'orphan'}:${e.platform}:${e.marketExternalId}`;
    const bucket = byMarket.get(key) ?? [];
    bucket.push(e);
    byMarket.set(key, bucket);
  }

  const trips: RealRoundTrip[] = [];

  for (const [, marketEvents] of byMarket) {
    let net = 0;
    let cost = 0;
    let tripPnl = 0;
    let tripOpen = false;
    let openedAt: Date | null = null;
    let buyCount = 0;
    let sellCount = 0;
    let buyNotional = 0;
    let sellNotional = 0;
    const strategyId = marketEvents[0]?.strategyId ?? null;
    const platform = marketEvents[0]?.platform ?? 'polymarket';
    const marketExternalId = marketEvents[0]?.marketExternalId ?? '';

    for (const e of marketEvents) {
      if (e.side === 'BUY') {
        if (net <= 0.01) {
          tripPnl = 0;
          tripOpen = true;
          openedAt = e.at;
          buyCount = 0;
          sellCount = 0;
          buyNotional = 0;
          sellNotional = 0;
        }
        net += e.size;
        cost += e.size * e.price + e.fee;
        buyCount++;
        buyNotional += e.size * e.price;
      } else {
        const avg = net > 0.01 ? cost / net : e.price;
        tripPnl += (e.price - avg) * e.size - e.fee;
        net -= e.size;
        cost -= avg * e.size;
        sellCount++;
        sellNotional += e.size * e.price;
        if (net <= 0.01 && tripOpen && openedAt) {
          const question =
            marketQuestions?.get(marketExternalId) ?? marketExternalId.slice(0, 80);
          const assessment = assessFastMovingMarket({
            id: marketExternalId,
            question,
            externalId: marketExternalId,
            platform: platform as 'polymarket',
            status: 'open',
            updatedAt: new Date().toISOString(),
          });
          trips.push({
            strategyId,
            marketExternalId,
            platform,
            kind: assessment.kind,
            pnlUsd: tripPnl,
            holdMs: e.at.getTime() - openedAt.getTime(),
            buyCount,
            sellCount,
            openedAt,
            closedAt: e.at,
            avgEntry: buyCount > 0 ? buyNotional / buyCount : 0,
            avgExit: sellCount > 0 ? sellNotional / sellCount : e.price,
          });
          tripOpen = false;
          net = 0;
          cost = 0;
        }
      }
    }
  }

  return trips;
}

export async function analyzeLiveRoundTrips(windowHours = 24): Promise<LiveAttributionSummary> {
  const since = new Date(Date.now() - windowHours * 3600 * 1000);
  const fills = await db.query.realTrades.findMany({
    where: and(eq(realTrades.status, 'filled'), gte(realTrades.filledAt, since)),
    orderBy: (t, { asc }) => [asc(t.filledAt)],
    limit: 2000,
  });

  const signalIds = fills.map((f) => f.signalId).filter(Boolean) as string[];
  const signalToStrategy: Record<string, string> = {};
  for (const ids of chunkArray(signalIds)) {
    if (ids.length === 0) continue;
    const batch = await db.query.signals.findMany({
      where: inArray(signals.id, ids),
      columns: { id: true, strategyId: true },
    });
    for (const s of batch) signalToStrategy[s.id] = s.strategyId;
  }

  const tokenIds = [...new Set(fills.map((f) => f.marketExternalId))];
  const marketQuestions = await loadMarketQuestionsByExternalIds(tokenIds);
  const trips = roundTripsFromEvents(
    buildEventsFromFills(fills, signalToStrategy),
    marketQuestions,
  );

  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let totalPnlUsd = 0;
  const byKind: LiveAttributionSummary['byKind'] = {};

  for (const t of trips) {
    totalPnlUsd += t.pnlUsd;
    if (t.pnlUsd > 0.02) wins++;
    else if (t.pnlUsd < -0.02) losses++;
    else breakeven++;

    const k = byKind[t.kind] ?? { trips: 0, pnlUsd: 0, wins: 0, losses: 0 };
    k.trips++;
    k.pnlUsd += t.pnlUsd;
    if (t.pnlUsd > 0.02) k.wins++;
    else if (t.pnlUsd < -0.02) k.losses++;
    byKind[t.kind] = k;
  }

  const sportsTrips = trips.filter((t) => t.kind === 'sports-live' || t.kind === 'sports');
  const sportsWins = sportsTrips.filter((t) => t.pnlUsd > 0.02).length;
  const sportsLiveWinRatePct =
    sportsTrips.length >= 3 ? (sportsWins / sportsTrips.length) * 100 : null;

  return {
    windowHours,
    roundTrips: trips.length,
    wins,
    losses,
    breakeven,
    totalPnlUsd,
    avgPnlPerTripUsd: trips.length > 0 ? totalPnlUsd / trips.length : 0,
    winRatePct: trips.length > 0 ? (wins / trips.length) * 100 : 0,
    byKind,
    recentTrips: trips.slice(-12).reverse(),
    sportsLiveWinRatePct,
  };
}
