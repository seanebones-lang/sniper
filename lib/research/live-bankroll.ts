/**
 * Live bankroll helpers for micro-account scaled thresholds.
 */
import { isLiveExecutionEnabled } from '@/lib/research/strategy-attribution';

const DEFAULT_MICRO_BANKROLL = 25;

export function getDefaultLiveBankrollUsd(): number {
  return DEFAULT_MICRO_BANKROLL;
}

/** Scale a dollar threshold as a fraction of bankroll (e.g. 0.15 → -15% of $25 = -$3.75). */
export function bankrollScaledUsd(bankrollUsd: number, fraction: number): number {
  return bankrollUsd * fraction;
}

export async function resolveLiveBankrollUsd(cycleBalance: number | null | undefined): Promise<number> {
  if (!isLiveExecutionEnabled()) return DEFAULT_MICRO_BANKROLL;
  if (cycleBalance != null && cycleBalance > 0) return cycleBalance;
  try {
    const { getPolymarketPrivateKey, getPolymarketUsdcBalance } = await import(
      '@/lib/clients/polymarket-trading'
    );
    const pk = getPolymarketPrivateKey();
    if (pk) {
      const bal = await getPolymarketUsdcBalance(pk, { syncFirst: false });
      if (bal != null && bal > 0) return bal;
    }
  } catch {
    // fall through
  }
  const snap = (await import('@/lib/clients/polymarket-trading-setup')).getPolymarketSetupSnapshot();
  if (snap?.balanceUsd && snap.balanceUsd > 0) return snap.balanceUsd;
  return DEFAULT_MICRO_BANKROLL;
}
