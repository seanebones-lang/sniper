/** CLOB-delisted / dead-book tokens — never attempt exits (wastes cycles + blocks new entries). */
export const DEAD_MARKET_TOKENS = new Set([
  '66001827658606844994148463229238966813912518248224954388385421446299173647931',
  '29654367635997330423989480284203408826351645806994843236766252973777536670042',
  '89440958677242635922243599682220367772270030849875850155268863561815210329601',
  '112793399830376345322195515723949689838787043880683449958745426972655010908000',
  '55728804666668494994148463229238966813912518248224954388385421446299173647931',
  // Game 4 — shares locked in resting CLOB sell; ledger written off
  '47147095594506692238697896514087867152422362229643774019197234088324196335335',
  // Penny junk BUY @ 0.01 — stuck pending SELL; ledger write-off
  '75462822077155991283832425183355777507517211994653365831437501592509625094792',
  // Dead-book holds from 2026-06-03 flatten (no bids; min size blocks exit)
  '70811926991397248719387258769471036542160353290588981197576580940612207510064',
  '35118054228408586137252795703746404222680776903323171910764298245336074845982',
]);

/** Discovered at runtime (empty book / repeated exit failures) — persisted in system_state. */
const runtimeDeadMarketTokens = new Set<string>();

export function isDeadMarketToken(tokenId: string): boolean {
  return DEAD_MARKET_TOKENS.has(tokenId) || runtimeDeadMarketTokens.has(tokenId);
}

export function getRuntimeDeadMarketTokens(): string[] {
  return [...runtimeDeadMarketTokens];
}

export async function hydrateRuntimeDeadMarketTokens(): Promise<void> {
  try {
    const { loadSystemState } = await import('@/lib/monitoring/system-state');
    const state = await loadSystemState<{ runtimeDeadTokens?: string[] }>('live_self_heal');
    if (!state?.runtimeDeadTokens) return;
    for (const id of state.runtimeDeadTokens) {
      if (!DEAD_MARKET_TOKENS.has(id)) runtimeDeadMarketTokens.add(id);
    }
  } catch {
    // best effort
  }
}

export async function markRuntimeDeadMarketToken(tokenId: string, reason: string): Promise<boolean> {
  if (isDeadMarketToken(tokenId)) return false;
  runtimeDeadMarketTokens.add(tokenId);
  try {
    const { loadSystemState, persistSystemState } = await import('@/lib/monitoring/system-state');
    const prev = (await loadSystemState<{ runtimeDeadTokens?: string[]; lastHealAt?: string }>(
      'live_self_heal',
    )) ?? { runtimeDeadTokens: [] };
    const merged = [...new Set([...(prev.runtimeDeadTokens ?? []), tokenId])];
    await persistSystemState(
      'live_self_heal',
      { ...prev, runtimeDeadTokens: merged, lastMarkedDeadAt: new Date().toISOString(), lastMarkReason: reason },
      reason,
    );
  } catch {
    // in-memory still applies this process
  }
  return true;
}

/** Legacy 1000-lot penny positions from bad paper-era fills. */
export function isLegacyPennyPosition(avgEntryPrice: number, netSize: number): boolean {
  return avgEntryPrice <= 0.002 && netSize >= 50;
}

/** Fractional ledger residue after round-trip — not a real open position. */
export function isDustOpenPosition(netSize: number, avgEntryPrice: number): boolean {
  const notional = netSize * avgEntryPrice;
  if (notional < 0.35) return true;
  if (netSize < 1 && notional < 0.75) return true;
  return false;
}

/** Counts toward live micro position cap (ignore dust/dead ledger noise). */
export function isMeaningfulOpenPosition(netSize: number, avgEntryPrice: number): boolean {
  if (isDustOpenPosition(netSize, avgEntryPrice)) return false;
  return netSize >= 0.5 || netSize * avgEntryPrice >= 0.5;
}
