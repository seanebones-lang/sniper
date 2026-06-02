/**
 * Kalshi Authenticated Trading Client (Phase 4+)
 * 
 * Kalshi uses RSA private key authentication.
 * See: https://docs.kalshi.com/
 * 
 * This is currently a skeleton. Full order placement, balance, positions,
 * and order management can be built on top of this foundation.
 */

import * as crypto from 'crypto';

const KALSHI_BASE = 'https://external-api.kalshi.com/trade-api/v2';

interface KalshiCredentials {
  accessKey: string;
  privateKey: string; // PEM formatted RSA private key
}

let cachedClient: KalshiTradingClient | null = null;

export function getKalshiTradingClient(credentials?: KalshiCredentials): KalshiTradingClient {
  if (cachedClient) return cachedClient;

  if (!credentials) {
    const accessKey = process.env.KALSHI_ACCESS_KEY;
    const privateKey = process.env.KALSHI_RSA_PRIVATE_KEY;

    if (!accessKey || !privateKey) {
      throw new Error('Kalshi trading credentials not found (KALSHI_ACCESS_KEY / KALSHI_RSA_PRIVATE_KEY)');
    }

    credentials = { accessKey, privateKey };
  }

  cachedClient = new KalshiTradingClient(credentials);
  return cachedClient;
}

export class KalshiTradingClient {
  private accessKey: string;
  private privateKey: string;
  private token?: string;
  private tokenExpiry?: Date;

  constructor(creds: KalshiCredentials) {
    this.accessKey = creds.accessKey;
    this.privateKey = creds.privateKey;
  }

  private async getAuthToken(): Promise<string> {
    if (this.token && this.tokenExpiry && this.tokenExpiry > new Date()) {
      return this.token;
    }

    // Kalshi uses a login flow with signed timestamp
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const message = `${this.accessKey}GET/trade-api/v2/login${timestamp}`;

    const sign = crypto.sign('sha256', Buffer.from(message), {
      key: this.privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    });

    const signature = sign.toString('base64');

    const res = await fetch(`${KALSHI_BASE}/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'KALSHI-ACCESS-KEY': this.accessKey,
        'KALSHI-SIGNED-TIMESTAMP': timestamp,
        'KALSHI-SIGNED-SIGNATURE': signature,
      },
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Kalshi login failed: ${res.status} ${text}`);
    }

    const data = await res.json();
    this.token = data.token;
    // Tokens are typically valid for ~1 hour
    this.tokenExpiry = new Date(Date.now() + 50 * 60 * 1000);

    return this.token!;
  }

  async getBalance(): Promise<any> {
    const token = await this.getAuthToken();
    const res = await fetch(`${KALSHI_BASE}/portfolio/balance`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Kalshi balance error: ${res.status}`);
    return res.json();
  }

  // TODO: Implement createOrder, cancelOrder, getPositions, getFills, etc.
  // These would follow the same auth pattern as getBalance.

  /**
   * Placeholder for future reconciliation use.
   * In a full implementation this would call /portfolio/orders/{id} or similar.
   */
  async getOrderStatus(orderIdOrTicker: string): Promise<{ status: string; filled?: boolean; [k: string]: unknown }> {
    // For now return a safe default so recon can call it without crashing
    return { status: 'unknown', filled: false };
  }

  async placeOrder(params: {
    ticker: string;
    side: 'yes' | 'no';
    type: 'limit' | 'market';
    count: number;
    price?: number; // in cents (1-99)
  }): Promise<any> {
    const token = await this.getAuthToken();

    const body = {
      ticker: params.ticker,
      side: params.side,
      type: params.type,
      count: params.count,
      ...(params.price && { price: params.price }),
    };

    const res = await fetch(`${KALSHI_BASE}/portfolio/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Kalshi order failed: ${res.status} ${text}`);
    }

    return res.json();
  }
}
