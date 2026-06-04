/**
 * Polymarket trading readiness — matches official SDK + open-source bot pattern:
 * derive API creds, sync CLOB balance, ready when funded. Relayer approvals are
 * one-time setup (background), not a runtime gate.
 *
 * @see https://docs.polymarket.com/trading/quickstart
 * @see robottraders.io — client.derive_api_key(); client.set_api_creds(creds)
 */

import { AssetType } from '@polymarket/clob-client-v2';
import { db, auditEvents } from '@/lib/db';
import {
  ensurePolymarketApiCreds,
  getPolymarketPrivateKey,
  getPolymarketUsdcBalance,
  getTradingClient,
  resetTradingClientCache,
  resolvePolymarketSignatureType,
  syncPolymarketCollateralBalance,
} from '@/lib/clients/polymarket-trading';
import { ensurePolymarketProxyConfigured } from '@/lib/clients/polymarket-http-proxy';
import {
  executeGaslessApprovals,
  getRelayerCredentials,
  spendersNeedingApproval,
} from '@/lib/clients/polymarket-relayer';
import { getErrorMessage } from '@/lib/error-message';

export interface PolymarketTradingReadyResult {
  ready: boolean;
  balanceUsd: number | null;
  approvalsSubmitted: boolean;
  relayerMode: string;
  signatureType?: number;
  allowancesOk?: boolean;
  funderAddress?: string;
  relayerProxyMismatch?: boolean;
  message?: string;
}

const SETUP_TTL_MS = 60_000;
const MIN_TRADE_BALANCE_USD = 0.5;
let lastSetupAt = 0;
let lastResult: PolymarketTradingReadyResult | null = null;
let approvalAttemptAt = 0;

export async function ensurePolymarketTradingReady(options?: {
  force?: boolean;
}): Promise<PolymarketTradingReadyResult> {
  const now = Date.now();
  if (!options?.force && lastResult && now - lastSetupAt < SETUP_TTL_MS) {
    return lastResult;
  }

  const privateKey = getPolymarketPrivateKey();
  if (!privateKey) {
    lastResult = {
      ready: false,
      balanceUsd: null,
      approvalsSubmitted: false,
      relayerMode: 'none',
      message: 'POLYMARKET_PRIVATE_KEY not set',
    };
    lastSetupAt = now;
    return lastResult;
  }

  const relayerMode = getRelayerCredentials().mode;
  if (options?.force) {
    resetTradingClientCache();
  }

  try {
    await ensurePolymarketProxyConfigured();
    const signatureType = await resolvePolymarketSignatureType(privateKey);
    const funderAddress = process.env.POLYMARKET_FUNDER_ADDRESS?.trim();

    try {
      await syncPolymarketCollateralBalance(privateKey);
    } catch (syncErr) {
      console.warn('[Polymarket] collateral sync skipped:', getErrorMessage(syncErr));
    }

    const client = getTradingClient(privateKey);
    await ensurePolymarketApiCreds(client);

    const balParams = {
      asset_type: AssetType.COLLATERAL,
      signature_type: signatureType,
    };

    let allowancesOk: boolean | undefined;
    let needApproval: string[] = [];
    try {
      const balAllowance = await client.getBalanceAllowance(balParams);
      const allowances = (balAllowance as { allowances?: Record<string, string> })?.allowances;
      needApproval = spendersNeedingApproval(allowances);
      allowancesOk = needApproval.length === 0;
    } catch (allowErr) {
      console.warn('[Polymarket] allowance read skipped:', getErrorMessage(allowErr));
    }

    const balanceUsd = await getPolymarketUsdcBalance(privateKey, { syncFirst: false });

    // Standard bot readiness: funded CLOB + working L2 creds (not relayer success every cycle).
    const ready = balanceUsd != null && balanceUsd >= MIN_TRADE_BALANCE_USD;

    // Background relayer approvals — at most once per 10 minutes, never blocks ready.
    let approvalsSubmitted = false;
    if (
      needApproval.length > 0 &&
      relayerMode !== 'none' &&
      now - approvalAttemptAt > 10 * 60_000
    ) {
      approvalAttemptAt = now;
      void executeGaslessApprovals(privateKey, needApproval)
        .then(async (approval) => {
          await logAudit('polymarket_relayer_approvals', {
            spenders: needApproval,
            ok: approval.ok,
            txHash: approval.txHash,
            error: approval.error,
            relayerMode,
            background: true,
          });
          if (approval.ok) {
            await syncPolymarketCollateralBalance(privateKey);
          }
        })
        .catch(() => {});
    }

    lastResult = {
      ready,
      balanceUsd,
      approvalsSubmitted,
      relayerMode,
      signatureType,
      allowancesOk,
      funderAddress,
      relayerProxyMismatch: false,
      message: ready
        ? allowancesOk
          ? undefined
          : `Funded ($${balanceUsd!.toFixed(2)}) — exchange allowances pending (relayer retry in background)`
        : balanceUsd != null && balanceUsd > 0
          ? `CLOB balance $${balanceUsd.toFixed(2)} below $${MIN_TRADE_BALANCE_USD} minimum`
          : balanceUsd === 0
            ? `CLOB balance $0 — deposit USDC on polymarket.com (${funderAddress?.slice(0, 10) ?? 'funder'}…)`
            : 'Could not read Polymarket CLOB balance (check proxy + API creds)',
    };
    lastSetupAt = now;

    if (ready) {
      await logAudit('polymarket_trading_ready', {
        balanceUsd,
        relayerMode,
        allowancesOk,
      });
    } else {
      await logAudit('polymarket_trading_not_ready', { ...lastResult });
    }

    return lastResult;
  } catch (err) {
    const message = getErrorMessage(err);
    lastResult = {
      ready: false,
      balanceUsd: null,
      approvalsSubmitted: false,
      relayerMode,
      message,
    };
    lastSetupAt = now;
    await logAudit('polymarket_trading_setup_error', { error: message });
    return lastResult;
  }
}

export function clearPolymarketSetupCache() {
  lastSetupAt = 0;
  lastResult = null;
}

export function getPolymarketSetupSnapshot(): PolymarketTradingReadyResult | null {
  return lastResult;
}

/**
 * Spendable USDC for live sizing — CLOB read first, cached setup on 504/proxy flake.
 * Never returns 0 on a transient read failure when a recent funded snapshot exists.
 */
export async function resolveLiveUsdcBalance(privateKey: string): Promise<number | null> {
  let bal = await getPolymarketUsdcBalance(privateKey, { syncFirst: false });
  if (bal != null && bal > 0) return bal;

  const snap = getPolymarketSetupSnapshot();
  if (snap?.balanceUsd != null && snap.balanceUsd > 0) return snap.balanceUsd;

  bal = await getPolymarketUsdcBalance(privateKey, { syncFirst: true });
  if (bal != null && bal > 0) return bal;

  const setup = await ensurePolymarketTradingReady();
  if (setup.balanceUsd != null && setup.balanceUsd > 0) return setup.balanceUsd;

  return snap?.balanceUsd ?? bal;
}

async function logAudit(action: string, payload: Record<string, unknown>) {
  try {
    await db.insert(auditEvents).values({
      actor: 'polymarket-setup',
      action,
      payload,
    });
  } catch {
    // best effort
  }
}
