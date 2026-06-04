/**
 * Detect closed round-trips after a real fill and record outcomes / cooldowns.
 */
import { db, realTrades, signals } from '@/lib/db';
import { eq, and, gte, inArray } from 'drizzle-orm';
import { roundTripsFromEvents } from '@/lib/execution/real-strategy-pnl';
import { appendLiveTradeOutcome } from '@/lib/monitoring/live-trade-outcomes';
import { recordTokenLossCooldown, getLiveFilterOverrides } from '@/lib/monitoring/live-intelligence';

export async function onRealFillRecorded(tradeId: string): Promise<void> {
  const trade = await db.query.realTrades.findFirst({
    where: eq(realTrades.id, tradeId),
  });
  if (!trade || trade.status !== 'filled' || trade.side !== 'SELL') return;

  const since = new Date(Date.now() - 48 * 3600 * 1000);
  const fills = await db.query.realTrades.findMany({
    where: and(
      eq(realTrades.marketExternalId, trade.marketExternalId),
      eq(realTrades.status, 'filled'),
      gte(realTrades.filledAt, since),
    ),
    orderBy: (t, { asc }) => [asc(t.filledAt)],
  });

  const signalIds = fills.map((f) => f.signalId).filter(Boolean) as string[];
  const signalToStrategy: Record<string, string> = {};
  if (signalIds.length > 0) {
    const sigs = await db.query.signals.findMany({
      where: inArray(signals.id, signalIds),
      columns: { id: true, strategyId: true },
    });
    for (const s of sigs) signalToStrategy[s.id] = s.strategyId;
  }

  const events = fills
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
    .filter((e) => Number.isFinite(e.size));

  const trips = roundTripsFromEvents(events);
  const closedAt = trade.filledAt ?? new Date();
  const matching = trips.filter(
    (t) => Math.abs(t.closedAt.getTime() - closedAt.getTime()) < 120_000,
  );
  if (matching.length === 0) return;

  const trip = matching[matching.length - 1];
  await appendLiveTradeOutcome(trip);

  if (trip.pnlUsd < -0.05) {
    const { tokenCooldownMs } = await getLiveFilterOverrides();
    await recordTokenLossCooldown(trade.marketExternalId, tokenCooldownMs);
  }
}
