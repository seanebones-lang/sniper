/**
 * Production live ops snapshot + optional auto-resume when learning re-paused entries.
 * Usage: SNIPER_BASE_URL=https://... npx tsx scripts/live-ops-monitor.ts [--fix]
 */
const BASE = process.env.SNIPER_BASE_URL?.replace(/\/$/, '') ?? 'https://sniper-production-e817.up.railway.app';
const FIX = process.argv.includes('--fix');

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}

async function patchIntelligence(body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/real/intelligence`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function main() {
  const [runner, real, intel] = await Promise.all([
    get<Record<string, unknown>>('/api/runner'),
    get<Record<string, unknown>>('/api/real/status'),
    get<{ state: Record<string, unknown> }>('/api/real/intelligence'),
  ]);

  const cycle = (runner.lastCycle ?? {}) as Record<string, unknown>;
  const state = intel.state ?? {};

  const report = {
    at: new Date().toISOString(),
    running: runner.running,
    executionMode: runner.executionMode,
    clobUsd: real.polymarketUsdcBalance,
    tradingReady: (real.tradingSetup as Record<string, unknown> | undefined)?.ready,
    entriesPaused: state.entriesPaused,
    entriesPausedReason: state.entriesPausedReason,
    marketsEvaluated: cycle.marketsEvaluated,
    skipReason: cycle.skipReason,
    riskMode: cycle.riskMode,
    polyConnected: (cycle.bookFetch as Record<string, unknown> | undefined)?.polyConnected,
    lastRun: runner.lastRun,
  };

  console.log(JSON.stringify(report, null, 2));

  const kindPause =
    state.entriesPaused === true &&
    String(state.entriesPausedReason ?? '').includes('allow-listed market kinds blocked');

  const legacyLossPause =
    state.entriesPaused === true &&
    String(state.entriesPausedReason ?? '').includes('breached −');

  if (FIX && (kindPause || legacyLossPause)) {
    const fix = await patchIntelligence({
      clearEntriesPaused: true,
      allowedKinds: null,
      blockedKinds: ['short-crypto'],
    });
    console.log('auto-fix:', JSON.stringify(fix));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
