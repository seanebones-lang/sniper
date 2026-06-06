/**
 * Enable BTC Sniper live — deactivate other strategies, clear intelligence blocks.
 * Usage: railway run --service sniper npx tsx scripts/enable-btc-sniper-live.ts
 */
import { db, strategies } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { normalizeStrategyConfig } from '@/lib/strategies/run-profile';
import { saveLiveIntelligenceState } from '@/lib/monitoring/live-intelligence';

const BTC_SNIPER_CONFIG = normalizeStrategyConfig('btc-sniper', {
  tradingGoal: 'btc-momentum',
  tradingStyle: 'aggressive',
  liveMarketsOnly: true,
  maxSizeUsd: 1,
  targetProfitPct: 12,
  stopLossPct: 8,
  maxHoldSeconds: 120,
  cooldownSeconds: 10,
  btcWindowFilter: 'both',
  rsiPeriod: 7,
  rsiBuyUpMax: 35,
  rsiBuyDownMin: 65,
  minMomentumPct: 0.4,
  maxImpliedPrice: 0.5,
  minEdgeAfterSpreadPct: 4,
});

async function main() {
  const all = await db.query.strategies.findMany();

  for (const s of all) {
    await db
      .update(strategies)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(strategies.id, s.id));
  }

  const existing = all.find((s) => s.type === 'btc-sniper');
  let rowId: string;

  if (existing) {
    await db
      .update(strategies)
      .set({
        name: 'BTC Sniper Live',
        isActive: true,
        paperOnly: false,
        config: BTC_SNIPER_CONFIG,
        maxSizeUsd: '1',
        targetProfitPct: '12',
        cooldownSeconds: 10,
        updatedAt: new Date(),
      })
      .where(eq(strategies.id, existing.id));
    rowId = existing.id;
  } else {
    const [inserted] = await db
      .insert(strategies)
      .values({
        name: 'BTC Sniper Live',
        type: 'btc-sniper',
        isActive: true,
        paperOnly: false,
        config: BTC_SNIPER_CONFIG,
        maxSizeUsd: '1',
        targetProfitPct: '12',
        cooldownSeconds: 10,
      })
      .returning({ id: strategies.id });
    rowId = inserted!.id;
  }

  await saveLiveIntelligenceState(
    {
      allowedKinds: ['short-crypto'],
      blockedKinds: [],
      entriesPaused: false,
      entriesPausedReason: undefined,
      tokenCooldownMs: 10 * 60 * 1000,
    },
    'enable btc sniper live',
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        strategyId: rowId,
        type: 'btc-sniper',
        paperOnly: false,
        config: BTC_SNIPER_CONFIG,
        note: 'Start runner via POST /api/runner action=start',
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
