/**
 * One-shot / periodic Polymarket trading readiness: CLOB balance sync + gasless approvals.
 */

import { AssetType } from '@polymarket/clob-client-v2';
import { db, auditEvents } from '@/lib/db';
import {
  ensurePolymarketApiCreds,
  getPolymarketPrivateKey,
  getPolymarketSignatureType,
  getPolymarketUsdcBalance,
  getTradingClient,
  resetTradingClientCache,
  resolvePolymarketSignatureType,
  syncPolymarketCollateralBalance,
} from '@/lib/clients/polymarket-trading';
import {
  executeGaslessApprovals,
  funderMatchesRelayerProxy,
  getDerivedRelayerProxyAddress,
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

const SETUP_TTL_MS = 5 * 60 * 1000;
let lastSetupAt = 0;
let lastResult: PolymarketTradingReadyResult | null = null;

export async function ensurePolymarketTradingReady(options?: {
  force?: boolean;
}): Promise<PolymarketTradingReadyResult> {
  const now = Date.now();
  if (
    !options?.force &&
    lastResult &&
    now - lastSetupAt < SETUP_TTL_MS
  ) {
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
  const signatureType = await resolvePolymarketSignatureType(privateKey);

  try {
    await syncPolymarketCollateralBalance(privateKey);

    const client = getTradingClient(privateKey);
    await ensurePolymarketApiCreds(client);
    const balParams = {
      asset_type: AssetType.COLLATERAL,
      signature_type: signatureType,
    };
    const balAllowance = await client.getBalanceAllowance(balParams);
    const allowances = (balAllowance as { allowances?: Record<string, string> })
      ?.allowances;

    const funderAddress = process.env.POLYMARKET_FUNDER_ADDRESS?.trim();
    let derivedProxy = await getDerivedRelayerProxyAddress(privateKey);
    if (signatureType === 3) {
      try {
        const { createRelayClient } = await import('@/lib/clients/polymarket-relayer');
        const relay = createRelayClient(privateKey);
        derivedProxy = (await relay.deriveDepositWalletAddress?.()) ?? derivedProxy;
      } catch {
        // keep CREATE2 proxy derive fallback
      }
    }
    const relayerProxyMismatch =
      signatureType !== 3 &&
      !!funderAddress &&
      !!derivedProxy &&
      !funderMatchesRelayerProxy(funderAddress, derivedProxy);

    const needApproval = spendersNeedingApproval(allowances);
    const allowancesOk = needApproval.length === 0;
    let approvalsSubmitted = false;

    if (needApproval.length > 0 && relayerProxyMismatch) {
      lastResult = {
        ready: false,
        balanceUsd: await getPolymarketUsdcBalance(privateKey),
        approvalsSubmitted: false,
        relayerMode,
        allowancesOk: false,
        funderAddress,
        relayerProxyMismatch: true,
        message:
          'Magic/proxy funder differs from relayer-derived wallet — enable trading once on polymarket.com (Settings → approve), then re-run setup.',
      };
      lastSetupAt = now;
      await logAudit('polymarket_relayer_proxy_mismatch', {
        funderAddress,
        derivedProxy,
      });
      return lastResult;
    }

    if (needApproval.length > 0) {
      const approval = await executeGaslessApprovals(privateKey, needApproval);
      approvalsSubmitted = approval.ok;
      await logAudit('polymarket_relayer_approvals', {
        spenders: needApproval,
        ok: approval.ok,
        txHash: approval.txHash,
        error: approval.error,
        relayerMode,
      });
      if (!approval.ok) {
        lastResult = {
          ready: false,
          balanceUsd: await getPolymarketUsdcBalance(privateKey),
          approvalsSubmitted: false,
          relayerMode,
          message: approval.error,
        };
        lastSetupAt = now;
        return lastResult;
      }
      await syncPolymarketCollateralBalance(privateKey);
    }

    const balanceUsd = await getPolymarketUsdcBalance(privateKey, { syncFirst: true });
    const ready =
      balanceUsd != null &&
      balanceUsd >= 0.5 &&
      spendersNeedingApproval(
        (await client.getBalanceAllowance(balParams)).allowances,
      ).length === 0;

    lastResult = {
      ready,
      balanceUsd,
      approvalsSubmitted,
      relayerMode,
      signatureType,
      allowancesOk,
      funderAddress,
      relayerProxyMismatch,
      message: ready
        ? undefined
        : !allowancesOk
          ? 'Exchange allowances still zero — approve on polymarket.com or fix relayer setup'
          : balanceUsd != null && balanceUsd < 0.5
            ? `CLOB trading balance $${balanceUsd.toFixed(2)} — on polymarket.com use Deposit/Transfer to move Cash into the CLOB wallet (${funderAddress?.slice(0, 10) ?? 'funder'}…)`
            : 'Polymarket trading not ready',
    };
    lastSetupAt = now;

    if (!ready) {
      await logAudit('polymarket_trading_not_ready', { ...lastResult });
    } else {
      await logAudit('polymarket_trading_ready', {
        balanceUsd,
        relayerMode,
        approvalsSubmitted,
      });
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

/** Non-blocking read of last setup result (for status APIs). */
export function getPolymarketSetupSnapshot(): PolymarketTradingReadyResult | null {
  return lastResult;
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
