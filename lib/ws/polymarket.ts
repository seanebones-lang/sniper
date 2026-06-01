/**
 * Polymarket WebSocket Client (Market Channel)
 * Phase 2: Real-time updates with robust heartbeats + reconnect.
 *
 * Docs reference: wss://ws-subscriptions-clob.polymarket.com/ws/market
 */

export type PolymarketWSMessage =
  | { type: 'book'; asset_id: string; bids: any[]; asks: any[] }
  | { type: 'price_change'; asset_id: string; price: string; size?: string; side?: string }
  | { type: 'last_trade_price'; asset_id: string; price: string }
  | { type: 'best_bid_ask'; asset_id: string; bid: string; ask: string }
  | { type: 'tick_size_change'; asset_id: string; old: string; new: string }
  | { event_type: 'PONG' | 'PING' }
  | any; // allow unknown for forward compat

export interface PolymarketWSOptions {
  onMessage: (msg: PolymarketWSMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (err: any) => void;
}

const WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
const HEARTBEAT_INTERVAL = 8000; // send PING every 8s (docs say ~10s tolerance)

export class PolymarketWSClient {
  private ws: WebSocket | null = null;
  private assetIds: string[] = [];
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private isManuallyClosed = false;

  constructor(private options: PolymarketWSOptions) {}

  connect(assetIds: string[]) {
    this.assetIds = assetIds;
    this.isManuallyClosed = false;
    this._connectInternal();
  }

  private _connectInternal() {
    if (this.ws) {
      this.ws.close();
    }

    this.ws = new WebSocket(WS_URL);

    this.ws.onopen = () => {
      console.log('[PolymarketWS] Connected');
      this.reconnectAttempts = 0;
      this._subscribe();
      this._startHeartbeat();
      this.options.onOpen?.();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.options.onMessage(data);
      } catch (e) {
        console.warn('[PolymarketWS] Failed to parse message', event.data);
      }
    };

    this.ws.onclose = () => {
      console.log('[PolymarketWS] Disconnected');
      this._stopHeartbeat();
      this.options.onClose?.();

      if (!this.isManuallyClosed) {
        this._scheduleReconnect();
      }
    };

    this.ws.onerror = (err) => {
      console.error('[PolymarketWS] Error', err);
      this.options.onError?.(err);
    };
  }

  private _subscribe() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const msg = {
      assets_ids: this.assetIds,
      type: 'market',
      custom_feature_enabled: true,
    };
    this.ws.send(JSON.stringify(msg));
    console.log('[PolymarketWS] Subscribed to', this.assetIds.length, 'assets');
  }

  private _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ event_type: 'PING' }));
      }
    }, HEARTBEAT_INTERVAL);
  }

  private _stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private _scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    const delay = Math.min(1000 * Math.pow(1.6, this.reconnectAttempts), 15000);
    this.reconnectAttempts++;

    console.log(`[PolymarketWS] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this._connectInternal();
    }, delay);
  }

  updateSubscriptions(newAssetIds: string[]) {
    this.assetIds = newAssetIds;
    if (this.ws?.readyState === WebSocket.OPEN) {
      // Simple approach: resubscribe (Polymarket supports dynamic subscribe)
      this._subscribe();
    }
  }

  disconnect() {
    this.isManuallyClosed = true;
    this._stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
