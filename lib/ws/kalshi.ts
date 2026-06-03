/**
 * Kalshi WebSocket Client
 * Requires API key auth on handshake; subscribe via params.channels + market_tickers.
 * @see https://docs.kalshi.com/getting_started/quick_start_websockets
 */

import {
  createKalshiWsAuthHeaders,
  getKalshiCredentialsOptional,
  type KalshiCredentials,
} from '@/lib/clients/kalshi-auth';

export type KalshiWSMessage = Record<string, unknown>;

export type KalshiWSChannel = 'ticker' | 'orderbook_delta' | 'trade';

export interface KalshiWSOptions {
  onMessage: (msg: KalshiWSMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (err: Event | Error) => void;
  /** Channels to subscribe when market_tickers are set. Default: orderbook_delta */
  channels?: KalshiWSChannel[];
  credentials?: KalshiCredentials | null;
}

const WS_URL = 'wss://external-api-ws.kalshi.com/trade-api/ws/v2';

export class KalshiWSClient {
  private ws: WebSocket | null = null;
  private tickers: string[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private isManuallyClosed = false;
  private messageId = 1;
  private readonly channels: KalshiWSChannel[];
  private readonly credentials: KalshiCredentials | null;
  private authUnavailableLogged = false;

  constructor(private options: KalshiWSOptions) {
    this.channels = options.channels ?? ['orderbook_delta'];
    this.credentials = options.credentials ?? getKalshiCredentialsOptional();
  }

  connect(tickers: string[]) {
    this.tickers = tickers;
    this.isManuallyClosed = false;

    if (!this.credentials) {
      if (!this.authUnavailableLogged) {
        console.warn(
          '[KalshiWS] Skipping connect — set KALSHI_ACCESS_KEY and KALSHI_RSA_PRIVATE_KEY for WebSocket',
        );
        this.authUnavailableLogged = true;
      }
      this.options.onClose?.();
      return;
    }

    if (tickers.length === 0) {
      this.disconnect();
      return;
    }

    this._connectInternal();
  }

  private _connectInternal() {
    if (!this.credentials) return;
    if (this.ws) this.ws.close();

    const headers = createKalshiWsAuthHeaders(this.credentials);
    // Runtime supports auth headers; DOM WebSocket typings only allow protocol string(s).
    this.ws = new WebSocket(WS_URL, { headers } as unknown as string[]);

    this.ws.onopen = () => {
      console.log('[KalshiWS] Connected (authenticated)');
      this.reconnectAttempts = 0;
      this._subscribe();
      this.options.onOpen?.();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as KalshiWSMessage;
        if (data.type === 'error') {
          const errMsg = data.msg as Record<string, unknown> | undefined;
          console.warn('[KalshiWS] Server error:', errMsg?.code, errMsg?.msg);
          return;
        }
        this.options.onMessage(data);
      } catch {
        // ignore malformed messages
      }
    };

    this.ws.onclose = (event) => {
      console.log('[KalshiWS] Disconnected', event.code, event.reason || '');
      this.options.onClose?.();
      if (!this.isManuallyClosed) this._scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      console.error('[KalshiWS] Error', err);
      this.options.onError?.(err);
    };
  }

  private _subscribe() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.tickers.length === 0) return;

    const msg = {
      id: this.messageId++,
      cmd: 'subscribe',
      params: {
        channels: this.channels,
        market_tickers: this.tickers,
      },
    };
    this.ws.send(JSON.stringify(msg));
    console.log(
      `[KalshiWS] Subscribed ${this.channels.join(',')} for ${this.tickers.length} tickers`,
    );
  }

  private _scheduleReconnect() {
    if (!this.credentials || this.tickers.length === 0) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = Math.min(1000 * Math.pow(1.7, this.reconnectAttempts), 20000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => this._connectInternal(), delay);
  }

  disconnect() {
    this.isManuallyClosed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  updateSubscriptions(newTickers: string[]) {
    const prev = this.tickers.join(',');
    this.tickers = newTickers;
    if (!this.credentials || newTickers.length === 0) {
      this.disconnect();
      this.options.onClose?.();
      return;
    }
    const next = newTickers.join(',');
    if (prev === next && this.ws?.readyState === WebSocket.OPEN) return;

    if (this.ws?.readyState === WebSocket.OPEN) {
      // Reconnect to apply a new market set (avoids "already subscribed" errors).
      const old = this.ws;
      this.ws = null;
      old.close();
      this.isManuallyClosed = false;
      this._connectInternal();
      return;
    }
    this.connect(newTickers);
  }
}

/** Build top-of-book from Kalshi ticker WS envelope or flat message. */
export function parseKalshiWSBook(
  msg: KalshiWSMessage,
  ticker: string,
): import('../types').OrderBook | null {
  const payload =
    msg.type === 'ticker' && msg.msg && typeof msg.msg === 'object'
      ? (msg.msg as KalshiWSMessage)
      : msg;

  const msgTicker = String(payload.market_ticker ?? payload.ticker ?? '');
  if (msgTicker && msgTicker !== ticker) return null;

  const yesBidRaw = payload.yes_bid_dollars ?? payload.yes_bid;
  const yesAskRaw = payload.yes_ask_dollars ?? payload.yes_ask;
  if (yesBidRaw == null || yesAskRaw == null) return null;

  const yesBid =
    typeof yesBidRaw === 'string'
      ? parseFloat(yesBidRaw)
      : typeof yesBidRaw === 'number'
        ? yesBidRaw > 1
          ? yesBidRaw / 100
          : yesBidRaw
        : NaN;
  const yesAsk =
    typeof yesAskRaw === 'string'
      ? parseFloat(yesAskRaw)
      : typeof yesAskRaw === 'number'
        ? yesAskRaw > 1
          ? yesAskRaw / 100
          : yesAskRaw
        : NaN;

  if (Number.isNaN(yesBid) || Number.isNaN(yesAsk)) return null;

  return {
    platform: 'kalshi',
    marketExternalId: ticker,
    bids: [{ price: yesBid, size: 1 }],
    asks: [{ price: yesAsk, size: 1 }],
    mid: (yesBid + yesAsk) / 2,
    spread: yesAsk - yesBid,
    timestamp: new Date().toISOString(),
  };
}
