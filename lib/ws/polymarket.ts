/**
 * Polymarket WebSocket Client (Market Channel)
 * Phase 2: Real-time updates with robust heartbeats + reconnect.
 */

export interface ClobBookLevel {
  price: string;
  size: string;
}

export type PolymarketWSMessage =
  | { type: 'book'; asset_id: string; bids: ClobBookLevel[]; asks: ClobBookLevel[]; event_type?: string }
  | { type: 'price_change'; asset_id: string; price: string; size?: string; side?: string; event_type?: string }
  | { type: 'last_trade_price'; asset_id: string; price: string; event_type?: string }
  | { type: 'best_bid_ask'; asset_id: string; bid: string; ask: string; event_type?: string }
  | { type: 'tick_size_change'; asset_id: string; old: string; new: string; event_type?: string }
  | { event_type: 'PONG' | 'PING' | 'book' | 'best_bid_ask'; asset_id?: string; bids?: ClobBookLevel[]; asks?: ClobBookLevel[]; bid?: string; ask?: string };

export interface PolymarketWSOptions {
  onMessage: (msg: PolymarketWSMessage) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (err: Event | Error) => void;
}

export class PolymarketWSClient {
  private ws: WebSocket | null = null;
  private assetIds: string[] = [];
  private subscribedIds = new Set<string>();
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
      this.subscribedIds.clear();
      this._sendInitialSubscribe();
      this._startHeartbeat();
      this.options.onOpen?.();
    };

    this.ws.onmessage = (event) => {
      const raw = event.data as string;
      if (typeof raw === 'string' && !raw.trimStart().startsWith('{')) {
        if (raw.includes('INVALID')) {
          console.warn('[PolymarketWS]', raw.trim());
        }
        return;
      }
      try {
        const data = JSON.parse(raw) as PolymarketWSMessage;
        this.options.onMessage(data);
      } catch {
        console.warn('[PolymarketWS] Failed to parse message', raw.slice(0, 120));
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

  private _sendInitialSubscribe() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.assetIds.length === 0) return;

    this.ws.send(
      JSON.stringify({
        assets_ids: this.assetIds,
        type: 'market',
        custom_feature_enabled: true,
      }),
    );
    this.subscribedIds = new Set(this.assetIds);
    console.log('[PolymarketWS] Subscribed to', this.assetIds.length, 'assets');
  }

  private _sendDelta(ids: string[], operation: 'subscribe' | 'unsubscribe') {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || ids.length === 0) return;

    this.ws.send(
      JSON.stringify({
        assets_ids: ids,
        operation,
        custom_feature_enabled: true,
      }),
    );
  }

  private _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send('PING');
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
    const nextSet = new Set(newAssetIds);
    const toAdd = newAssetIds.filter((id) => !this.subscribedIds.has(id));
    const toRemove = [...this.subscribedIds].filter((id) => !nextSet.has(id));
    this.assetIds = newAssetIds;

    if (this.ws?.readyState !== WebSocket.OPEN) return;

    if (this.subscribedIds.size === 0 && newAssetIds.length > 0) {
      this._sendInitialSubscribe();
      return;
    }

    if (toRemove.length > 0) {
      this._sendDelta(toRemove, 'unsubscribe');
      for (const id of toRemove) this.subscribedIds.delete(id);
    }
    if (toAdd.length > 0) {
      this._sendDelta(toAdd, 'subscribe');
      for (const id of toAdd) this.subscribedIds.add(id);
    }
  }

  disconnect() {
    this.isManuallyClosed = true;
    this._stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.subscribedIds.clear();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

const WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
const HEARTBEAT_INTERVAL = 8000;

function messageKind(msg: PolymarketWSMessage): string | undefined {
  if ('type' in msg && typeof msg.type === 'string') return msg.type;
  if ('event_type' in msg && typeof msg.event_type === 'string') return msg.event_type;
  return undefined;
}

/** Convert a Polymarket WS book/ticker message into a normalized OrderBook. */
export function parsePolymarketWSBook(
  msg: PolymarketWSMessage,
  assetId: string,
): import('../types').OrderBook | null {
  const kind = messageKind(msg);
  const msgAssetId = 'asset_id' in msg ? msg.asset_id : undefined;
  if (msgAssetId !== assetId) return null;

  if (kind === 'book') {
    const bids = (('bids' in msg ? msg.bids : []) ?? [])
      .map((b) => ({ price: parseFloat(b.price), size: parseFloat(b.size) }))
      .filter((l) => l.price > 0 && l.size > 0)
      .sort((a, b) => b.price - a.price);
    const asks = (('asks' in msg ? msg.asks : []) ?? [])
      .map((a) => ({ price: parseFloat(a.price), size: parseFloat(a.size) }))
      .filter((l) => l.price > 0 && l.size > 0)
      .sort((a, b) => a.price - b.price);
    const mid = bids[0] && asks[0] ? (bids[0].price + asks[0].price) / 2 : undefined;
    const spread = bids[0] && asks[0] ? asks[0].price - bids[0].price : undefined;
    return {
      platform: 'polymarket',
      marketExternalId: assetId,
      bids,
      asks,
      mid,
      spread,
      timestamp: new Date().toISOString(),
    };
  }

  if (kind === 'best_bid_ask' && 'bid' in msg && 'ask' in msg && msg.bid != null && msg.ask != null) {
    const bid = parseFloat(msg.bid);
    const ask = parseFloat(msg.ask);
    if (Number.isNaN(bid) || Number.isNaN(ask)) return null;
    return {
      platform: 'polymarket',
      marketExternalId: assetId,
      bids: [{ price: bid, size: 1 }],
      asks: [{ price: ask, size: 1 }],
      mid: (bid + ask) / 2,
      spread: ask - bid,
      timestamp: new Date().toISOString(),
    };
  }

  return null;
}
