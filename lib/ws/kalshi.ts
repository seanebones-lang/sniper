/**
 * Kalshi WebSocket Client (public channels)
 * Phase 2: Basic ticker + trade updates.
 */

export type KalshiWSMessage = Record<string, unknown>;

export interface KalshiWSOptions {
  onMessage: (msg: KalshiWSMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (err: Event | Error) => void;
}

const WS_URL = 'wss://external-api-ws.kalshi.com/trade-api/ws/v2';

export class KalshiWSClient {
  private ws: WebSocket | null = null;
  private tickers: string[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private isManuallyClosed = false;

  constructor(private options: KalshiWSOptions) {}

  connect(tickers: string[]) {
    this.tickers = tickers;
    this.isManuallyClosed = false;
    this._connectInternal();
  }

  private _connectInternal() {
    if (this.ws) this.ws.close();

    this.ws = new WebSocket(WS_URL);

    this.ws.onopen = () => {
      console.log('[KalshiWS] Connected');
      this.reconnectAttempts = 0;
      this._subscribe();
      this.options.onOpen?.();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data as string) as KalshiWSMessage;
        this.options.onMessage(data);
      } catch {
        // ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      console.log('[KalshiWS] Disconnected');
      this.options.onClose?.();
      if (!this.isManuallyClosed) this._scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      this.options.onError?.(err);
    };
  }

  private _subscribe() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const msg = {
      id: Date.now(),
      cmd: 'subscribe',
      args: ['ticker', 'trade'],
      market_tickers: this.tickers,
    };
    this.ws.send(JSON.stringify(msg));
    console.log('[KalshiWS] Subscribed to', this.tickers.length, 'tickers');
  }

  private _scheduleReconnect() {
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
    this.tickers = newTickers;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this._subscribe();
    }
  }
}

/** Build a top-of-book OrderBook from Kalshi ticker WS messages. */
export function parseKalshiWSBook(
  msg: KalshiWSMessage,
  ticker: string,
): import('../types').OrderBook | null {
  const msgTicker = String(msg.market_ticker ?? msg.ticker ?? '');
  if (msgTicker && msgTicker !== ticker) return null;

  const yesBidRaw = msg.yes_bid_dollars ?? msg.yes_bid;
  const yesAskRaw = msg.yes_ask_dollars ?? msg.yes_ask;
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
