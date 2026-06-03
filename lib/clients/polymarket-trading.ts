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
import { getErrorMessage } from '@/lib/error-message';
import { ensurePolymarketProxyConfigured } from '@/lib/clients/polymarket-http-proxy';

const CLOB_HOST = 'https://clob.polymarket.com';

let tradingClient: ClobClient | null = null;
let resolvedSignatureType: number | null = null;
let proxyDerivedCreds: ApiKeyCreds | null = null;

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
export async function ensurePolymarketApiCreds(client: ClobClient): Promise<void> {
  const { resolvePolymarketProxyUrl } = await import('@/lib/clients/polymarket-http-proxy');
  const proxyUrl = await resolvePolymarketProxyUrl();
  const typed = client as ClobClient & { creds?: ApiKeyCreds };

  // Keys created from a US IP are rejected on order POST even when egress is proxied to IE.
  // Always derive L2 creds through the current egress (proxy) when a proxy is configured.
  if (proxyUrl) {
    if (proxyDerivedCreds?.key) {
      typed.creds = proxyDerivedCreds;
      return;
    }
    const nonce = Date.now();
    try {
      const created = await client.createApiKey(nonce);
      if (created?.key) {
        proxyDerivedCreds = created;
        typed.creds = created;
        console.log('[Polymarket] Fresh L2 API key created via proxy egress');
        return;
      }
    } catch (err) {
      console.warn(
        '[Polymarket] createApiKey via proxy failed, trying derive:',
        getErrorMessage(err),
      );
    }
    proxyDerivedCreds = await client.deriveApiKey(nonce);
    typed.creds = proxyDerivedCreds;
    return;
  }

  if (typed.creds?.key && typed.creds.secret && typed.creds.passphrase) return;

  const key = process.env.POLYMARKET_API_KEY?.trim();
  const secret = process.env.POLYMARKET_API_SECRET?.trim();
  const passphrase = process.env.POLYMARKET_API_PASSPHRASE?.trim();
  if (key && secret && passphrase) {
    typed.creds = { key, secret, passphrase };
    return;
  }

  const creds = await client.createOrDeriveApiKey();
  typed.creds = creds;
}

export interface PolymarketOrderOptions {
  tickSize: string;
  negRisk: boolean;
}

export async function getPolymarketOrderOptions(tokenId: string): Promise<PolymarketOrderOptions> {
  const privateKey = getPolymarketPrivateKey();
  if (!privateKey) {
    return { tickSize: '0.01', negRisk: false };
  }
  const client = getTradingClient(privateKey);
  await ensurePolymarketApiCreds(client);
  const [tickSize, negRisk] = await Promise.all([
    client.getTickSize(tokenId),
    client.getNegRisk(tokenId),
  ]);
  return {
    tickSize: String(tickSize),
    negRisk: Boolean(negRisk),
  };
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
        const oid = String(row.order_id ?? row.orderID ?? row.taker_order_id ?? '');
        return oid === orderId;
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

export async function getPolymarketOpenOrders(privateKey: string): Promise<unknown[]> {
  try {
    const client = getTradingClient(privateKey);
    await ensurePolymarketApiCreds(client);
    const orders = await client.getOpenOrders(undefined, true);
    return Array.isArray(orders) ? orders : [];
  } catch (err) {
    console.error('[Polymarket] getOpenOrders failed:', err);
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

function collateralBalanceParams(): BalanceAllowanceParams {
  return {
    asset_type: AssetType.COLLATERAL,
    signature_type: getPolymarketSignatureType(),
  } as BalanceAllowanceParams;
}

/** Sync CLOB balance cache after deposits (required for Magic/deposit wallets). */
export async function syncPolymarketCollateralBalance(privateKey: string): Promise<void> {
  const client = getTradingClient(privateKey);
  await ensurePolymarketApiCreds(client);
  await client.updateBalanceAllowance(collateralBalanceParams());
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
  try {
    await resolvePolymarketSignatureType(privateKey);
    const client = getTradingClient(privateKey);
    await ensurePolymarketApiCreds(client);
    const params = collateralBalanceParams();
    if (options?.syncFirst !== false) {
      await client.updateBalanceAllowance(params);
    }
    const bal = await client.getBalanceAllowance(params);
    return parseCollateralBalanceUsd((bal as { balance?: string })?.balance);
  } catch (err) {
    console.warn('[Polymarket] getBalanceAllowance failed:', getErrorMessage(err));
    return null;
  }
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
    const { bootstrapPolymarketHttp } = await import('@/lib/clients/polymarket-http-proxy');
    await bootstrapPolymarketHttp();
    const { ensurePolymarketTradingReady } = await import('@/lib/clients/polymarket-trading-setup');
    await ensurePolymarketTradingReady();

    const client = getTradingClient(params.privateKey);
    await ensurePolymarketApiCreds(client);
    await client.updateBalanceAllowance(collateralBalanceParams());

    const options = await getPolymarketOrderOptions(params.tokenId);
    const orderType = params.orderType === 'FAK' ? OrderType.FAK : OrderType.FOK;

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

    const parsed = parsePolymarketPostOrderResult(order);
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
    const { bootstrapPolymarketHttp } = await import('@/lib/clients/polymarket-http-proxy');
    await bootstrapPolymarketHttp();
    const { ensurePolymarketTradingReady } = await import(
      '@/lib/clients/polymarket-trading-setup'
    );
    await ensurePolymarketTradingReady();

    const client = getTradingClient(params.privateKey);
    await ensurePolymarketApiCreds(client);
    await client.updateBalanceAllowance(collateralBalanceParams());

    const options = await getPolymarketOrderOptions(params.tokenId);

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

    const parsed = parsePolymarketPostOrderResult(order);
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
