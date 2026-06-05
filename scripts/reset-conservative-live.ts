/**
 * One-shot prod reset: fresh session bankroll + resume Conservative entries.
 * Usage: railway run --service sniper npx tsx scripts/reset-conservative-live.ts
 */
import { persistSystemState } from '@/lib/monitoring/system-state';
import { saveLiveIntelligenceState } from '@/lib/monitoring/live-intelligence';

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  await persistSystemState(
    'live_session_bankroll',
    {
      startBankrollUsd: 25,
      dayUtc: today,
      updatedAt: new Date().toISOString(),
    },
    'manual reset for Conservative live restart',
  );
  const next = await saveLiveIntelligenceState(
    {
      entriesPaused: false,
      entriesPausedReason: undefined,
      allowedKinds: null,
      blockedKinds: ['short-crypto'],
    },
    'manual Conservative restart',
  );
  console.log(JSON.stringify({ ok: true, entriesPaused: next.entriesPaused, blockedKinds: next.blockedKinds }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
