/**
 * Gasless Polymarket proxy setup via the relayer (approvals, etc.).
 * Uses RELAYER_API_KEY + RELAYER_API_KEY_ADDRESS from env, or legacy POLY_BUILDER_* HMAC creds.
 */

import { RelayClient, RelayerTxType, type Transaction } from '@polymarket/builder-relayer-client';
import { BuilderConfig, BuilderApiKeyCreds } from '@polymarket/builder-signing-sdk';
import { encodeFunctionData, maxUint256, type Hex } from 'viem';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';
import { getPolymarketPrivateKey } from '@/lib/clients/polymarket-trading';
import { getErrorMessage } from '@/lib/error-message';

const RELAYER_URL = 'https://relayer-v2.polymarket.com/';

/** V2 collateral (pUSD) on Polygon mainnet */
export const PUSD_ADDRESS = '0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB' as const;

/** CTF Exchange V2 spenders — must be approved for the CLOB to trade */
export const PUSD_EXCHANGE_SPENDERS = [
  '0xE111180000d2663C0091e4f400237545B87B996B',
  '0xe2222d279d744050d28e00520010520000310F59',
  '0xd91E80cF2E7be2e162c6513ceD06f1dD0dA35296',
] as const;

const ERC20_APPROVE_ABI = [
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

export interface RelayerCredentials {
  mode: 'relayer_api_key' | 'builder_hmac' | 'none';
}

export function getRelayerCredentials(): RelayerCredentials {
  const relayerKey = process.env.RELAYER_API_KEY?.trim();
  const relayerAddr = process.env.RELAYER_API_KEY_ADDRESS?.trim();
  if (relayerKey && relayerAddr?.startsWith('0x')) {
    return { mode: 'relayer_api_key' };
  }
  const builderKey = process.env.POLY_BUILDER_API_KEY?.trim();
  const builderSecret = process.env.POLY_BUILDER_SECRET?.trim();
  const builderPass = process.env.POLY_BUILDER_PASSPHRASE?.trim();
  if (builderKey && builderSecret && builderPass) {
    return { mode: 'builder_hmac' };
  }
  return { mode: 'none' };
}

function buildBuilderConfig(): BuilderConfig | undefined {
  const key = process.env.POLY_BUILDER_API_KEY?.trim();
  const secret = process.env.POLY_BUILDER_SECRET?.trim();
  const passphrase = process.env.POLY_BUILDER_PASSPHRASE?.trim();
  if (!key || !secret || !passphrase) return undefined;
  return new BuilderConfig({
    localBuilderCreds: { key, secret, passphrase } as BuilderApiKeyCreds,
  });
}

function attachRelayerApiKeyHeaders(client: RelayClient): void {
  const apiKey = process.env.RELAYER_API_KEY?.trim();
  const apiKeyAddress = process.env.RELAYER_API_KEY_ADDRESS?.trim();
  if (!apiKey || !apiKeyAddress) return;

  const http = client.httpClient;
  const originalSend = http.send.bind(http);
  http.send = async (endpoint, method, options) => {
    return originalSend(endpoint, method, {
      ...options,
      headers: {
        ...options?.headers,
        RELAYER_API_KEY: apiKey,
        RELAYER_API_KEY_ADDRESS: apiKeyAddress,
      },
    });
  };
}

export function createRelayClient(privateKey: string): RelayClient {
  const account = privateKeyToAccount(privateKey as Hex);
  const wallet = createWalletClient({
    account,
    chain: polygon,
    transport: http(),
  });

  const signatureType = parseInt(process.env.POLYMARKET_SIGNATURE_TYPE ?? '0', 10);
  // Deposit wallets (type 3) use relayer WALLET batches — not legacy PROXY relayer txs.
  const relayTxType =
    signatureType === 1
      ? RelayerTxType.PROXY
      : signatureType === 3
        ? RelayerTxType.SAFE
        : RelayerTxType.SAFE;

  // Relayer API key auth and builder HMAC are mutually exclusive on the relayer API.
  const creds = getRelayerCredentials();
  const builderConfig =
    creds.mode === 'relayer_api_key' ? undefined : buildBuilderConfig();
  const client = new RelayClient(
    RELAYER_URL,
    137,
    wallet as never,
    builderConfig,
    relayTxType,
    { chain: polygon },
  );

  if (creds.mode === 'relayer_api_key') {
    attachRelayerApiKeyHeaders(client);
  }

  return client;
}

export function buildPusdApprovalTransaction(spender: string): Transaction {
  return {
    to: PUSD_ADDRESS,
    data: encodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      functionName: 'approve',
      args: [spender as Hex, maxUint256],
    }),
    value: '0',
  };
}

/** CREATE2 proxy from signer — may differ from Magic `POLYMARKET_FUNDER_ADDRESS`. */
export async function getDerivedRelayerProxyAddress(
  privateKey: string,
): Promise<string | null> {
  try {
    const { getContractConfig } = await import(
      '@polymarket/builder-relayer-client/dist/config/index.js'
    );
    const { deriveProxyWallet } = await import(
      '@polymarket/builder-relayer-client/dist/builder/derive.js'
    );
    const account = privateKeyToAccount(privateKey as Hex);
    const cfg = getContractConfig(137);
    const factory = cfg.ProxyContracts?.ProxyFactory;
    if (!factory) return null;
    return deriveProxyWallet(account.address, factory);
  } catch {
    return null;
  }
}

export function funderMatchesRelayerProxy(
  funder: string | undefined,
  derivedProxy: string | null,
): boolean {
  if (!funder?.startsWith('0x') || !derivedProxy) return true;
  return funder.toLowerCase() === derivedProxy.toLowerCase();
}

export function spendersNeedingApproval(
  allowances: Record<string, string> | undefined,
): string[] {
  if (!allowances) return [...PUSD_EXCHANGE_SPENDERS];
  return PUSD_EXCHANGE_SPENDERS.filter((spender) => {
    const raw = allowances[spender] ?? allowances[spender.toLowerCase()];
    if (raw == null) return true;
    try {
      return BigInt(raw) === BigInt(0);
    } catch {
      return true;
    }
  });
}

export async function executeGaslessApprovals(
  privateKey: string,
  spenders: string[],
): Promise<{ ok: boolean; txHash?: string; error?: string }> {
  if (spenders.length === 0) {
    return { ok: true };
  }

  const creds = getRelayerCredentials();
  if (creds.mode === 'none') {
    return {
      ok: false,
      error:
        'Set RELAYER_API_KEY + RELAYER_API_KEY_ADDRESS (or POLY_BUILDER_* creds) for gasless approvals',
    };
  }

  const funder = process.env.POLYMARKET_FUNDER_ADDRESS?.trim();
  const derived = await getDerivedRelayerProxyAddress(privateKey);
  if (funder && derived && !funderMatchesRelayerProxy(funder, derived)) {
    return {
      ok: false,
      error:
        `Relayer proxy (${derived.slice(0, 10)}…) ≠ POLYMARKET_FUNDER_ADDRESS (${funder.slice(0, 10)}…). ` +
        'Approve trading on polymarket.com (Magic wallet) or use the exported key for this proxy.',
    };
  }

  try {
    const client = createRelayClient(privateKey);
    const txns = spenders.map((s) => buildPusdApprovalTransaction(s));
    const response = await client.execute(
      txns,
      `Sniper: approve pUSD for ${spenders.length} exchange(s)`,
    );
    const result = await response.wait();
    if (!result) {
      return { ok: false, error: 'Relayer approval transaction failed or timed out' };
    }
    return { ok: true, txHash: result.transactionHash };
  } catch (err) {
    return { ok: false, error: getErrorMessage(err) };
  }
}
