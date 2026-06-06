/**
 * Fresh live start: reset zen baseline, session bankroll, intelligence, runner counters.
 * Usage: railway run --service sniper npx tsx scripts/reset-live-fresh.ts
 */
import { getPolymarketPrivateKey } from '@/lib/clients/polymarket-trading';
import { resolveLiveUsdcBalance } from '@/lib/clients/polymarket-trading-setup';
import { saveLiveIntelligenceState } from '@/lib/monitoring/live-intelligence';
import { portfolioRiskManager } from '@/lib/risk/portfolio-manager';
import { resetLiveZenSession } from '@/lib/zen/live-session';
import { getZenEquitySnapshot } from '@/lib/zen/equity';

async function main() {
  const pk = getPolymarketPrivateKey();
  if (!pk) {
    console.error('POLYMARKET_PRIVATE_KEY not set');
    process.exit(1);
  }

  const clob = await resolveLiveUsdcBalance(pk);
  if (clob == null || clob <= 0) {
    console.error('Could not read CLOB balance');
    process.exit(1);
  }

  const session = await resetLiveZenSession(clob, 'reset-live-fresh script');
  portfolioRiskManager.applyMicroRealBudget(clob);
  portfolioRiskManager.resetDrawdown(clob);

  const intel = await saveLiveIntelligenceState(
    {
      entriesPaused: false,
      entriesPausedReason: undefined,
      allowedKinds: null,
      blockedKinds: ['short-crypto'],
    },
    'fresh live start',
  );

  const zen = await getZenEquitySnapshot();

  console.log(
    JSON.stringify(
      {
        ok: true,
        clobUsd: clob,
        zenStartedAt: session.zenStartedAt,
        startingBudgetUsd: session.startBankrollUsd,
        entriesPaused: intel.entriesPaused,
        zen: {
          liveEquityUsd: zen.liveEquityUsd,
          netPnlUsd: zen.netPnlUsd,
          fillCount: zen.fillCount,
          points: zen.points.length,
        },
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
