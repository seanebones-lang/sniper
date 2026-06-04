/**
 * Polymarket authenticated trading + reconciliation helpers.
 * Used only from real-executor and reconcile-real-trades (never paper paths).
 */

import {
  AssetType,
  ClobClient,
  COLLATERAL_TOKEN_DECIMALS,
  OrderType,
  Side,
  type ApiKeyCreds,
  type BalanceAllowanceParams,
} from '@polymarket/clob-client-v2';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';
import axios from 'axios';
import { getErrorMessage } from '@/lib/error-message';
import {
  ensurePolymarketProxyConfigured,
  getClobAxiosAgents,
} from '@/lib/clients/polymarket-http-proxy';

const CLOB_HOST = 'https://clob.polymarket.com';

let tradingClient: ClobClient | null = null;
let resolvedSignatureType: number | null = null;
let proxyDerivedCreds: ApiKeyCreds | null = null;
let envCredsInvalidated = false;

/** CLOB signature type: 0 EOA, 1 proxy, 2 Safe, 3 deposit wallet (POLY_1271). */
export function getPolymarketSignatureType(): number {
  if (resolvedSignatureType != null) return resolvedSignatureType;
  const st = parseInt(process.env.POLYMARKET_SIGNATURE_TYPE ?? '', 10);
  return Number.isNaN(st) ? 0 : st;
}

/** Pick signature type with the highest CLOB balance (env can be wrong for new accounts). */
export async function resolvePolymarketSignatureType(
  privateKey: string,
): Promise<number> {
  if (resolvedSignatureType != null) return resolvedSignatureType;

  const fromEnv = parseInt(process.env.POLYMARKET_SIGNATURE_TYPE ?? '', 10);
  if (!Number.isNaN(fromEnv)) {
    resolvedSignatureType = fromEnv;
    resetTradingClientCache();
    return fromEnv;
  }

  const funder = process.env.POLYMARKET_FUNDER_ADDRESS?.trim();
  if (!funder?.startsWith('0x')) {
    resolvedSignatureType = 0;
    return 0;
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: polygon,
    transport: http(),
  });
  const creds =
    process.env.POLYMARKET_API_KEY &&
    process.env.POLYMARKET_API_SECRET &&
    process.env.POLYMARKET_API_PASSPHRASE
      ? {
          key: process.env.POLYMARKET_API_KEY,
          secret: process.env.POLYMARKET_API_SECRET,
          passphrase: process.env.POLYMARKET_API_PASSPHRASE,
        }
      : null;

  let bestType = 3;
  let bestUsd = -1;

  for (const signatureType of [3, 1, 2, 0]) {
    const client = new ClobClient({
      host: CLOB_HOST,
      chain: 137,
      signer: walletClient as never,
      signatureType,
      funderAddress: funder as `0x${string}`,
      useServerTime: true,
    });
    if (creds) {
      (client as ClobClient & { creds: ApiKeyCreds }).creds = creds;
    } else {
      await ensurePolymarketApiCreds(client);
    }
    try {
      const balanceParams = {
        asset_type: AssetType.COLLATERAL,
        signature_type: signatureType,
      } as BalanceAllowanceParams;
      await client.updateBalanceAllowance(balanceParams);
      const bal = await client.getBalanceAllowance(balanceParams);
      const usd = parseCollateralBalanceUsd((bal as { balance?: string })?.balance) ?? 0;
      if (usd > bestUsd) {
        bestUsd = usd;
        bestType = signatureType;
      }
    } catch {
      // try next type
    }
  }

  resolvedSignatureType = bestType;
  resetTradingClientCache();
  return bestType;
}

export function resetTradingClientCache(): void {
  tradingClient = null;
  proxyDerivedCreds = null;
}

/** Drop cached L2 creds so the next call re-applies env or re-derives. */
export function invalidatePolymarketApiCreds(): void {
  proxyDerivedCreds = null;
  // Sig type 3 must keep Developers-tab env creds — transient 401/504 on balance
  // sync is not proof the keys are wrong (GitHub clob-client-v2 #66).
  if (getPolymarketSignatureType() !== 3) {
    envCredsInvalidated = true;
  }
  if (tradingClient) {
    const typed = tradingClient as ClobClient & { creds?: ApiKeyCreds };
    typed.creds = undefined;
  }
}

function isInvalidApiKeyError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('invalid api key') || lower.includes('unauthorized');
}

function isTransientOrderError(message: string): boolean {
  return /504|502|503|timeout|econnreset|gateway|network/i.test(message);
}

async function postPolymarketOrderWithRetry<T extends { success: boolean; error?: string }>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  let last = await fn();
  for (let attempt = 0; attempt < 2 && !last.success; attempt++) {
    const err = last.error ?? '';
    if (!isTransientOrderError(err) && !isInvalidApiKeyError(err)) break;
    if (isInvalidApiKeyError(err)) {
      invalidatePolymarketApiCreds();
    }
    console.warn(`[Polymarket] ${label} failed (${err.slice(0, 80)}), retry ${attempt + 2}/3…`);
    const { rotatePolymarketProxy } = await import('@/lib/clients/polymarket-http-proxy');
    await rotatePolymarketProxy(err.slice(0, 80));
    await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
    last = await fn();
  }
  return last;
}

export function getPolymarketPrivateKey(): string | undefined {
  const key = process.env.POLYMARKET_PRIVATE_KEY?.trim();
  return key && key.length > 0 ? key : undefined;
}

export function getTradingClient(privateKey: string): ClobClient {
  if (tradingClient) return tradingClient;

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: polygon,
    transport: http(),
  });

  const signatureType = getPolymarketSignatureType();
  const funderAddress = process.env.POLYMARKET_FUNDER_ADDRESS?.trim() as `0x${string}` | undefined;

  tradingClient = new ClobClient({
    host: CLOB_HOST,
    chain: 137,
    signer: walletClient as never,
    signatureType,
    funderAddress: funderAddress && funderAddress.startsWith('0x') ? funderAddress : undefined,
    useServerTime: true,
  });

  return tradingClient;
}

/** CLOB L2 endpoints require creds on the client; createOrDeriveApiKey only returns them. */
/**
 * L2 creds are only usable if key, secret, and passphrase are all present.
 * A key with an empty secret makes buildPolyHmacSignature throw
 * "secret is empty" on every order POST, so incomplete creds must never be
 * cached or applied.
 */
function credsComplete(creds?: ApiKeyCreds | null): creds is ApiKeyCreds {
  return Boolean(creds?.key && creds?.secret && creds?.passphrase);
}

export async function ensurePolymarketApiCreds(client: ClobClient): Promise<void> {
  await ensurePolymarketProxyConfigured();
  const typed = client as ClobClient & { creds?: ApiKeyCreds };

  if (credsComplete(proxyDerivedCreds)) {
    typed.creds = proxyDerivedCreds;
    return;
  }
  if (credsComplete(typed.creds)) return;

  const envKey = process.env.POLYMARKET_API_KEY?.trim();
  const envSecret = process.env.POLYMARKET_API_SECRET?.trim();
  const envPassphrase = process.env.POLYMARKET_API_PASSPHRASE?.trim();
  const envCreds =
    envKey && envSecret && envPassphrase
      ? { key: envKey, secret: envSecret, passphrase: envPassphrase }
      : null;
  const preferEnv = process.env.POLYMARKET_PREFER_ENV_API_CREDS === 'true';
  const sigType = getPolymarketSignatureType();

  // POLY_1271 (sig type 3): SDK createOrDeriveApiKey binds L2 key to EOA, not deposit
  // wallet — orders fail with "signer must match API KEY". Use Developers-tab creds.
  // @see https://github.com/Polymarket/clob-client-v2/issues/66
  if (sigType === 3 && credsComplete(envCreds)) {
    typed.creds = envCreds;
    proxyDerivedCreds = envCreds;
    envCredsInvalidated = false;
    return;
  }
  if (
    credsComplete(envCreds) &&
    !envCredsInvalidated &&
    (sigType === 3 || preferEnv)
  ) {
    typed.creds = envCreds;
    proxyDerivedCreds = envCreds;
    return;
  }

  // Types 0/1/2: derive at runtime (official quickstart pattern).
  try {
    const nonce = Date.now();
    try {
      const created = await client.createApiKey(nonce);
      if (credsComplete(created)) {
        proxyDerivedCreds = created;
        typed.creds = created;
        return;
      }
    } catch (err) {
      console.warn('[Polymarket] createApiKey failed, trying derive:', getErrorMessage(err));
    }
    try {
      const derived = await client.deriveApiKey(nonce);
      if (credsComplete(derived)) {
        proxyDerivedCreds = derived;
        typed.creds = derived;
        return;
      }
    } catch (err) {
      console.warn('[Polymarket] deriveApiKey failed, trying createOrDerive:', getErrorMessage(err));
    }
    const creds = await client.createOrDeriveApiKey(nonce);
    if (!credsComplete(creds)) {
      throw new Error(
        '[Polymarket] createOrDeriveApiKey returned incomplete creds (empty key/secret/passphrase)',
      );
    }
    proxyDerivedCreds = creds;
    typed.creds = creds;
    return;
  } catch (err) {
    // Last resort: env creds if derive failed
    if (credsComplete(envCreds) && !envCredsInvalidated) {
      typed.creds = envCreds;
      proxyDerivedCreds = envCreds;
      return;
    }
    throw err;
  }
}

export interface PolymarketOrderOptions {
  tickSize: string;
  negRisk: boolean;
  minOrderSize: number;
}

/** Per-market constraints from GET /book (docs: min_order_size, tick_size, neg_risk). */
export async function getPolymarketBookMeta(tokenId: string): Promise<PolymarketOrderOptions> {
  const fallback: PolymarketOrderOptions = {
    tickSize: '0.01',
    negRisk: false,
    minOrderSize: 5,
  };
  try {
    const book = await clobPublicGet<{
      tick_size?: string;
      neg_risk?: boolean;
      min_order_size?: string;
    }>('/book', { token_id: tokenId });
    return {
      tickSize: book.tick_size ?? '0.01',
      negRisk: book.neg_risk ?? false,
      minOrderSize: parseFloat(book.min_order_size ?? '5') || 5,
    };
  } catch {
    return fallback;
  }
}

/** CLOB client internal caches (not exported on the public type). */
interface ClobClientInternalCache {
  tickSizes: Record<string, string>;
  negRisk: Record<string, boolean>;
  feeInfos: Record<string, { rate: number; exponent: number }>;
  tokenConditionMap: Record<string, string>;
}

function clobInternalCache(client: ClobClient): ClobClientInternalCache {
  return client as unknown as ClobClientInternalCache;
}

async function clobPublicGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  await ensurePolymarketProxyConfigured();
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { getNextPublicClobAxiosAgents } = await import('@/lib/clients/polymarket-http-proxy');
      const agents = await getNextPublicClobAxiosAgents();
      const res = await axios.get(`${CLOB_HOST}${path}`, {
        params,
        timeout: 20_000,
        ...agents,
      });
      const data = res.data as { error?: unknown; status?: number };
      if (data && typeof data === 'object' && data.error != null) {
        throw new Error(String(data.error).slice(0, 240));
      }
      return res.data as T;
    } catch (err) {
      lastErr = err;
      if (attempt < 2) {
        const { rotatePolymarketProxy } = await import('@/lib/clients/polymarket-http-proxy');
        await rotatePolymarketProxy(getErrorMessage(err).slice(0, 80));
        await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(getErrorMessage(lastErr));
}

/** Pre-populate CLOB client caches so getTickSize does not crash on proxy error payloads. */
export async function primePolymarketTokenCache(
  client: ClobClient,
  tokenId: string,
): Promise<void> {
  const c = clobInternalCache(client);
  if (c.tickSizes?.[tokenId] && c.negRisk?.[tokenId] !== undefined && c.feeInfos?.[tokenId]) {
    return;
  }

  let conditionId = c.tokenConditionMap?.[tokenId];
  if (!conditionId) {
    const byToken = await clobPublicGet<{ condition_id?: string }>(
      `/markets-by-token/${tokenId}`,
    );
    const resolved = byToken.condition_id;
    if (!resolved) {
      throw new Error(`failed to resolve condition id for token ${tokenId.slice(0, 12)}…`);
    }
    conditionId = resolved;
    c.tokenConditionMap[tokenId] = conditionId;
  }

  const info = await clobPublicGet<{
    mts?: number;
    nr?: boolean;
    fd?: { r?: number; e?: number };
    t?: Array<{ t?: string }>;
  }>(`/clob-markets/${conditionId}`);

  if (info.mts == null) {
    throw new Error(`failed to fetch market info for condition id ${conditionId}`);
  }

  const tick = String(info.mts);
  const nr = info.nr ?? false;
  const fee = { rate: info.fd?.r ?? 0, exponent: info.fd?.e ?? 0 };

  for (const token of info.t ?? []) {
    if (!token?.t) continue;
    c.tokenConditionMap[token.t] = conditionId;
    c.tickSizes[token.t] = tick;
    c.negRisk[token.t] = nr;
    c.feeInfos[token.t] = fee;
  }

  c.tickSizes[tokenId] = tick;
  c.negRisk[tokenId] = nr;
  c.feeInfos[tokenId] = fee;
}

export async function getPolymarketOrderOptions(tokenId: string): Promise<PolymarketOrderOptions> {
  const privateKey = getPolymarketPrivateKey();
  if (!privateKey) {
    return { tickSize: '0.01', negRisk: false, minOrderSize: 5 };
  }
  try {
    const client = getTradingClient(privateKey);
    await ensurePolymarketApiCreds(client);
    await primePolymarketTokenCache(client, tokenId);
    const c = clobInternalCache(client);
    const bookMeta = await getPolymarketBookMeta(tokenId);
    return {
      tickSize: c.tickSizes[tokenId] ?? bookMeta.tickSize,
      negRisk: c.negRisk[tokenId] ?? bookMeta.negRisk,
      minOrderSize: bookMeta.minOrderSize,
    };
  } catch (err) {
    console.warn(
      `[Polymarket] token meta for ${tokenId.slice(0, 12)}… — using defaults:`,
      getErrorMessage(err),
    );
    return { tickSize: '0.01', negRisk: false, minOrderSize: 5 };
  }
}

export type PolymarketReconStatus = 'open' | 'filled' | 'cancelled' | 'unknown';

export interface PolymarketOrderRecon {
  orderId: string;
  status: PolymarketReconStatus;
  filledSize: number;
  originalSize: number;
  avgPrice: number;
}

/** Normalize CLOB getOrder / open-order payloads for reconciliation. */
export function parsePolymarketOrderForRecon(raw: unknown): PolymarketOrderRecon | null {
  if (!raw || typeof raw !== 'object') return null;
  const order = (raw as Record<string, unknown>).order ?? raw;
  if (!order || typeof order !== 'object') return null;
  const o = order as Record<string, unknown>;

  const orderId = String(o.orderID ?? o.order_id ?? o.id ?? '');
  if (!orderId) return null;

  const statusRaw = String(o.status ?? '').toUpperCase();
  const filledSize = parseFloat(String(o.size_matched ?? o.sizeMatched ?? '0'));
  const originalSize = parseFloat(String(o.original_size ?? o.originalSize ?? o.size ?? '0'));
  const avgPrice = parseFloat(String(o.price ?? o.avg_price ?? '0'));

  if (
    statusRaw === 'MATCHED' ||
    (filledSize > 0 && originalSize > 0 && filledSize >= originalSize * 0.99)
  ) {
    return {
      orderId,
      status: 'filled',
      filledSize: filledSize > 0 ? filledSize : originalSize,
      originalSize: originalSize || filledSize,
      avgPrice,
    };
  }

  if (statusRaw === 'CANCELED' || statusRaw === 'CANCELLED') {
    return {
      orderId,
      status: 'cancelled',
      filledSize,
      originalSize,
      avgPrice,
    };
  }

  if (statusRaw === 'LIVE' || statusRaw === 'OPEN' || filledSize < originalSize) {
    return {
      orderId,
      status: 'open',
      filledSize,
      originalSize,
      avgPrice,
    };
  }

  return {
    orderId,
    status: 'unknown',
    filledSize,
    originalSize,
    avgPrice,
  };
}

export async function fetchPolymarketOrder(
  privateKey: string,
  orderId: string,
): Promise<PolymarketOrderRecon | null> {
  try {
    const client = getTradingClient(privateKey);
    await ensurePolymarketApiCreds(client);
    const raw = await client.getOrder(orderId);
    return parsePolymarketOrderForRecon(raw);
  } catch (err) {
    console.warn('[Polymarket] getOrder failed:', getErrorMessage(err));
    return null;
  }
}

export async function fetchPolymarketTradesForOrder(
  privateKey: string,
  orderId: string,
  assetId?: string,
): Promise<Array<{ size: number; price: number }>> {
  try {
    const client = getTradingClient(privateKey);
    await ensurePolymarketApiCreds(client);
    const trades = await client.getTrades(
      assetId ? ({ asset_id: assetId } as { asset_id: string }) : {},
      true,
    );
    const list = Array.isArray(trades) ? trades : [];
    return list
      .filter((t) => {
        const row = t as unknown as Record<string, unknown>;
        for (const key of ['order_id', 'orderID', 'orderId', 'taker_order_id', 'maker_order_id']) {
          if (String(row[key] ?? '') === orderId) return true;
        }
        return false;
      })
      .map((t) => {
        const row = t as unknown as Record<string, unknown>;
        return {
          size: parseFloat(String(row.size ?? row.matched_amount ?? '0')),
          price: parseFloat(String(row.price ?? '0')),
        };
      })
      .filter((t) => t.size > 0 && t.price > 0);
  } catch {
    return [];
  }
}

/** CLOB may return an array or `{ data: Order[] }` depending on client/proxy version. */
export function normalizePolymarketOpenOrders(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const row = raw as Record<string, unknown>;
    if ('error' in row) return [];
    if (Array.isArray(row.data)) return row.data;
    if (Array.isArray(row.orders)) return row.orders;
    if (Array.isArray(row.results)) return row.results;
  }
  return [];
}

export async function getPolymarketOpenOrders(privateKey: string): Promise<unknown[]> {
  try {
    const client = getTradingClient(privateKey);
    await ensurePolymarketApiCreds(client);
    const orders = await client.getOpenOrders(undefined, true);
    if (Array.isArray(orders)) return orders;
    return normalizePolymarketOpenOrders(orders);
  } catch (err) {
    const msg = getErrorMessage(err);
    // Proxy/WAF may return non-array `data` — client throws on spread; heal still proceeds.
    if (!/not iterable/i.test(msg)) {
      console.warn('[Polymarket] getOpenOrders failed:', msg);
    }
    return [];
  }
}

export async function cancelPolymarketOrder(privateKey: string, orderId: string): Promise<boolean> {
  try {
    const client = getTradingClient(privateKey);
    await ensurePolymarketApiCreds(client);
    await client.cancelOrder({ orderID: orderId });
    return true;
  } catch {
    return false;
  }
}

/** Cancel every open order on this wallet (clears ghost locks getOpenOrders misses). */
export async function cancelAllPolymarketOrders(privateKey: string): Promise<boolean> {
  try {
    const client = getTradingClient(privateKey);
    await ensurePolymarketApiCreds(client);
    await client.cancelAll();
    return true;
  } catch (err) {
    console.warn('[Polymarket] cancelAll failed:', getErrorMessage(err));
    return false;
  }
}

/** Cancel all open orders for one outcome token. */
export async function cancelPolymarketMarketOrders(
  privateKey: string,
  tokenId: string,
): Promise<boolean> {
  try {
    const client = getTradingClient(privateKey);
    await ensurePolymarketApiCreds(client);
    await client.cancelMarketOrders({ asset_id: tokenId });
    return true;
  } catch (err) {
    console.warn('[Polymarket] cancelMarketOrders failed:', getErrorMessage(err));
    return false;
  }
}

function collateralBalanceParams(): BalanceAllowanceParams {
  return {
    asset_type: AssetType.COLLATERAL,
    signature_type: getPolymarketSignatureType(),
  } as BalanceAllowanceParams;
}

function conditionalBalanceParams(tokenId: string): BalanceAllowanceParams {
  return {
    asset_type: AssetType.CONDITIONAL,
    token_id: tokenId,
    signature_type: getPolymarketSignatureType(),
  } as BalanceAllowanceParams;
}

/** Sync CLOB conditional token cache before SELL orders. */
export async function syncPolymarketConditionalBalance(
  privateKey: string,
  tokenId: string,
): Promise<void> {
  const client = getTradingClient(privateKey);
  await ensurePolymarketApiCreds(client);
  await client.updateBalanceAllowance(conditionalBalanceParams(tokenId));
}

/** Outcome token balance in shares (6-decimal fixed point from CLOB). */
export async function getPolymarketTokenBalance(
  privateKey: string,
  tokenId: string,
): Promise<number | null> {
  try {
    const client = getTradingClient(privateKey);
    await ensurePolymarketApiCreds(client);
    await client.updateBalanceAllowance(conditionalBalanceParams(tokenId));
    const bal = await client.getBalanceAllowance(conditionalBalanceParams(tokenId));
    const raw = parseFloat((bal as { balance?: string })?.balance ?? '');
    if (!Number.isFinite(raw)) return null;
    return raw >= 1_000_000 ? raw / 10 ** COLLATERAL_TOKEN_DECIMALS : raw;
  } catch (err) {
    console.warn('[Polymarket] getTokenBalance failed:', getErrorMessage(err));
    return null;
  }
}

/** Sync CLOB balance cache after deposits (required for Magic/deposit wallets). */
export async function syncPolymarketCollateralBalance(privateKey: string): Promise<void> {
  const client = getTradingClient(privateKey);
  await ensurePolymarketApiCreds(client);
  const res = await client.updateBalanceAllowance(collateralBalanceParams());
  throwIfClobErrorResponse(res, 'updateBalanceAllowance');
}

function throwIfClobErrorResponse(res: unknown, label: string): void {
  if (!res || typeof res !== 'object') return;
  const r = res as { error?: unknown; status?: number };
  if (r.error == null || r.error === '') return;
  const status = r.status != null ? ` (${r.status})` : '';
  throw new Error(`${label}: ${String(r.error).slice(0, 240)}${status}`);
}

function parseCollateralBalanceUsd(raw: string | undefined | null): number | null {
  if (raw == null || raw === '') return null;
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return null;
  // CLOB collateral balance is in 6-decimal token units (pUSD/USDC)
  if (n >= 1_000_000 || String(raw).includes('.') === false) {
    return n / 10 ** COLLATERAL_TOKEN_DECIMALS;
  }
  return n;
}

export async function getPolymarketUsdcBalance(
  privateKey: string,
  options?: { syncFirst?: boolean },
): Promise<number | null> {
  let lastErr: string | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await resolvePolymarketSignatureType(privateKey);
      const client = getTradingClient(privateKey);
      await ensurePolymarketApiCreds(client);
      const params = collateralBalanceParams();
      if (options?.syncFirst !== false) {
        const sync = await client.updateBalanceAllowance(params);
        throwIfClobErrorResponse(sync, 'updateBalanceAllowance');
      }
      const bal = await client.getBalanceAllowance(params);
      throwIfClobErrorResponse(bal, 'getBalanceAllowance');
      const usd = parseCollateralBalanceUsd((bal as { balance?: string })?.balance);
      if (usd != null) return usd;
      throw new Error('getBalanceAllowance returned empty balance');
    } catch (err) {
      lastErr = getErrorMessage(err);
      if (attempt < 4) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
  }
  console.warn('[Polymarket] getBalanceAllowance failed:', lastErr);
  return null;
}

/** CLOB order ids are long hex/uuid strings — not the placeholder "submitted". */
export function isValidPolymarketOrderId(id: string | null | undefined): boolean {
  if (!id || typeof id !== 'string') return false;
  const t = id.trim();
  return t.length >= 16 && t !== 'submitted';
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

export function extractPolymarketOrderId(response: unknown): string | null {
  const r = asRecord(response);
  if (!r) return null;
  const nested = asRecord(r.data);
  const sources = [r, nested].filter(Boolean) as Record<string, unknown>[];

  for (const source of sources) {
    for (const key of ['orderID', 'order_id', 'orderId', 'id']) {
      const v = source[key];
      if (typeof v === 'string' && isValidPolymarketOrderId(v)) return v;
    }
    const hashes = source.orderHashes ?? source.order_hashes;
    if (Array.isArray(hashes)) {
      const first = hashes.find((h) => typeof h === 'string' && isValidPolymarketOrderId(h));
      if (typeof first === 'string') return first;
    }
    const tx = source.transactionsHashes ?? source.transaction_hashes;
    if (Array.isArray(tx)) {
      const first = tx.find((h) => typeof h === 'string' && isValidPolymarketOrderId(h));
      if (typeof first === 'string') return first;
    }
  }
  return null;
}

export function parsePolymarketPostOrderResult(
  order: unknown,
): { success: boolean; orderId?: string; error?: string; rawStatus?: string; raw?: unknown } {
  if (!order || typeof order !== 'object') {
    return { success: false, error: 'Invalid Polymarket response' };
  }
  const body = order as {
    success?: boolean;
    error?: string;
    errorMsg?: string;
    status?: number | string;
    orderID?: string;
  };

  const errText = (body.error ?? body.errorMsg ?? '').trim();
  const statusStr =
    body.status !== undefined && body.status !== null ? String(body.status) : undefined;
  const statusNum = statusStr != null && statusStr !== '' ? Number(statusStr) : NaN;
  const httpForbidden = statusNum === 403;

  if (body.success === false || httpForbidden) {
    return {
      success: false,
      error: errText || (httpForbidden ? 'Trading restricted (HTTP 403)' : 'Polymarket rejected order'),
      rawStatus: statusStr,
      raw: order,
    };
  }

  if (errText.length > 0) {
    const lower = errText.toLowerCase();
    if (
      lower.includes('restricted in your region') ||
      lower.includes('geoblock') ||
      lower.includes('not enough balance') ||
      lower.includes('min size') ||
      lower.includes('invalid')
    ) {
      return { success: false, error: errText, rawStatus: statusStr, raw: order };
    }
  }

  const orderId = extractPolymarketOrderId(order);
  if (!orderId) {
    return {
      success: false,
      error: errText || 'Polymarket response missing orderID — cannot track fill',
      rawStatus: statusStr,
      raw: order,
    };
  }

  return { success: true, orderId, rawStatus: statusStr };
}

export async function placePolymarketMarketOrder(params: {
  privateKey: string;
  tokenId: string;
  amountUsd: number;
  side: 'BUY' | 'SELL';
  orderType?: 'FOK' | 'FAK';
}): Promise<{ success: boolean; orderId?: string; error?: string; rawStatus?: string; raw?: unknown }> {
  try {
    await ensurePolymarketProxyConfigured();

    const client = getTradingClient(params.privateKey);
    await ensurePolymarketApiCreds(client);
    await primePolymarketTokenCache(client, params.tokenId);
    await client.updateBalanceAllowance(collateralBalanceParams());
    if (params.side === 'SELL') {
      await client.updateBalanceAllowance(conditionalBalanceParams(params.tokenId));
    }

    const options = await getPolymarketOrderOptions(params.tokenId);
    const orderType = params.orderType === 'FAK' ? OrderType.FAK : OrderType.FOK;

    const parsed = await postPolymarketOrderWithRetry('Market order', async () => {
      await ensurePolymarketApiCreds(client);
      const order = await client.createAndPostMarketOrder(
        {
          tokenID: params.tokenId,
          amount: params.amountUsd,
          side: params.side === 'BUY' ? Side.BUY : Side.SELL,
          orderType,
        },
        {
          tickSize: options.tickSize as '0.01',
          negRisk: options.negRisk,
        },
        orderType,
      );
      return parsePolymarketPostOrderResult(order);
    });

    if (!parsed.success) {
      console.warn('[Polymarket] Market order failed:', parsed.error, parsed.raw ? JSON.stringify(parsed.raw).slice(0, 400) : '');
    }
    return parsed;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Polymarket] Market order failed:', err);
    return { success: false, error: message };
  }
}

export async function placePolymarketLimitOrder(params: {
  privateKey: string;
  tokenId: string;
  price: number;
  size: number;
  side: 'BUY' | 'SELL';
  postOnly?: boolean;
}): Promise<{ success: boolean; orderId?: string; error?: string; rawStatus?: string; raw?: unknown }> {
  try {
    await ensurePolymarketProxyConfigured();

    const client = getTradingClient(params.privateKey);
    await ensurePolymarketApiCreds(client);
    await primePolymarketTokenCache(client, params.tokenId);
    await client.updateBalanceAllowance(collateralBalanceParams());
    if (params.side === 'SELL') {
      await client.updateBalanceAllowance(conditionalBalanceParams(params.tokenId));
    }

    const options = await getPolymarketOrderOptions(params.tokenId);

    if (params.size < options.minOrderSize) {
      return {
        success: false,
        error: `Size (${params.size}) lower than the minimum: ${options.minOrderSize}`,
      };
    }

    const parsed = await postPolymarketOrderWithRetry('Limit order', async () => {
      await ensurePolymarketApiCreds(client);
      const order = await client.createAndPostOrder(
        {
          tokenID: params.tokenId,
          price: params.price,
          size: params.size,
          side: params.side === 'BUY' ? Side.BUY : Side.SELL,
        },
        {
          tickSize: options.tickSize as '0.01',
          negRisk: options.negRisk,
        },
        OrderType.GTC,
        params.postOnly ?? false,
      );
      return parsePolymarketPostOrderResult(order);
    });

    if (!parsed.success) {
      console.warn(
        '[Polymarket] Order failed:',
        parsed.error,
        parsed.rawStatus ? `(status ${parsed.rawStatus})` : '',
        parsed.raw ? JSON.stringify(parsed.raw).slice(0, 400) : '',
      );
    }
    return parsed;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[Polymarket] Real order failed:', err);
    return { success: false, error: message };
  }
}
