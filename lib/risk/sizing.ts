/**
 * Convert USD risk cap to share count at a given price.
 * calculateSafeSize returns USD; strategies and simulators use shares.
 */
export function usdCapToShares(usdCap: number, price: number, minShares = 1): number {
  if (usdCap <= 0 || price <= 0) return 0;
  return Math.max(minShares, Math.floor(usdCap / price));
}

export function sharesToUsd(shares: number, price: number): number {
  return shares * price;
}

/** Minimum notional for a real order given current bankroll (supports micro accounts). */
export function minRealOrderUsd(bankrollUsd: number): number {
  if (bankrollUsd <= 25) return 1;
  if (bankrollUsd <= 100) return 1;
  return 5;
}

/** Polymarket FOK/market BUY minimum notional (exchange rule). */
export const POLYMARKET_MIN_MARKET_BUY_USD = 1;

/** Polymarket CLOB minimum share size for limit orders on most markets. */
export const POLYMARKET_MIN_SHARES = 5;

/** Round down to 4 decimal places (CLOB share precision). */
export function roundPolymarketShares(shares: number): number {
  if (!Number.isFinite(shares) || shares <= 0) return 0;
  return Math.floor(shares * 10_000) / 10_000;
}

/**
 * Apply risk multipliers to a signal, returning final share count.
 */
export function computeFinalShareSize(params: {
  requestedShares: number;
  riskCapUsd: number;
  price: number;
  isQuickFlipBuy: boolean;
  minSharesUsd?: number;
}): number {
  const { requestedShares, riskCapUsd, price, isQuickFlipBuy, minSharesUsd = 1 } = params;
  if (price <= 0 || riskCapUsd <= 0) return 0;

  if (isQuickFlipBuy) {
    return usdCapToShares(riskCapUsd, price, 1);
  }

  const capShares = usdCapToShares(riskCapUsd, price, 1);
  const shares = Math.min(requestedShares, capShares);
  if (shares * price < minSharesUsd) return 0;
  return shares;
}
