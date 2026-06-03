import { NextResponse } from 'next/server';
import { getErrorMessage } from '@/lib/error-message';
import { getRealExecutionStatus } from '@/lib/execution/real-executor';
import { getPolymarketPrivateKey, getPolymarketUsdcBalance } from '@/lib/clients/polymarket-trading';
import {
  ensurePolymarketTradingReady,
  getPolymarketSetupSnapshot,
} from '@/lib/clients/polymarket-trading-setup';
import { getRelayerCredentials } from '@/lib/clients/polymarket-relayer';
import { db, realTrades } from '@/lib/db';
import { eq, sql } from 'drizzle-orm';

export async function GET() {
  try {
    const status = await getRealExecutionStatus();

    const activeStrategies = await db.query.strategies.findMany({
      where: (s, { eq: eqOp }) => eqOp(s.isActive, true),
      columns: { id: true, name: true, paperOnly: true },
    });

    const recentPending = await db.query.realTrades.findMany({
      where: eq(realTrades.status, 'pending'),
      orderBy: (t, { desc }) => desc(t.createdAt),
      limit: 10,
      columns: {
        id: true,
        platform: true,
        marketExternalId: true,
        side: true,
        status: true,
        createdAt: true,
        txHash: true,
      },
    });

    const realCapableStrategies = activeStrategies.filter((s) => !s.paperOnly);

    const tradeStats = await db
      .select({ status: realTrades.status, cnt: sql<number>`count(*)::int` })
      .from(realTrades)
      .groupBy(realTrades.status);

    let polymarketUsdcBalance: number | null = null;
    const pk = getPolymarketPrivateKey();
    const tradingSetup = pk ? getPolymarketSetupSnapshot() : null;
    if (pk) {
      polymarketUsdcBalance = tradingSetup?.balanceUsd ?? null;
      // Refresh in background — do not block page load on Polymarket API probes
      void ensurePolymarketTradingReady().catch(() => {});
    }

    const untrackedPending = recentPending.filter(
      (t) => !t.txHash || t.txHash === 'submitted',
    ).length;

    return NextResponse.json({
      ...status,
      activeStrategies: activeStrategies.length,
      realCapableStrategies: realCapableStrategies.map((s) => ({
        id: s.id,
        name: s.name,
      })),
      recentPending,
      tradeStats,
      polymarketUsdcBalance,
      untrackedPendingOrders: untrackedPending,
      relayerCredentials: getRelayerCredentials().mode,
      tradingSetup,
      polymarketReady:
        status.envEnabled &&
        status.hasPolymarketKey &&
        status.allowed &&
        realCapableStrategies.length > 0 &&
        tradingSetup?.ready === true &&
        status.geoblock?.blocked !== true,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: getErrorMessage(err) || 'Failed to load real execution status' },
      { status: 500 },
    );
  }
}
