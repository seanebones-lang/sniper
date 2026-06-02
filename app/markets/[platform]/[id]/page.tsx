'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, Zap, TrendingUp } from 'lucide-react';
import type { OrderBook, Market } from '@/lib/types';
import { paperSimulator, type PaperFill } from '@/lib/execution/paper-simulator';

interface Props {
  params: Promise<{ platform: string; id: string }>;
}

export default function LiveMarketDetail({ params }: Props) {
  const [book, setBook] = useState<OrderBook | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [platform, setPlatform] = useState<string>('');
  const [marketId, setMarketId] = useState<string>('');
  const [isLive, setIsLive] = useState(false);
  const [fills, setFills] = useState<PaperFill[]>([]);
  const [snipePrice, setSnipePrice] = useState('');
  const [snipeSize, setSnipeSize] = useState('100');
  const [snipeSide, setSnipeSide] = useState<'BUY' | 'SELL'>('BUY');

  const wsRef = useRef<{ disconnect?: () => void } | null>(null);

  async function loadSnapshot() {
    const p = await params;
    setPlatform(p.platform);
    setMarketId(p.id);

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/markets/orderbook?platform=${p.platform}&id=${encodeURIComponent(p.id)}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setBook(data);
      if (!snipePrice && data.mid) {
        setSnipePrice((data.mid * 100).toFixed(1));
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to load order book';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  // Simple live WebSocket wiring (Polymarket only for Phase 2 demo)
  function toggleLive() {
    if (isLive) {
      wsRef.current?.disconnect?.();
      setIsLive(false);
      return;
    }

    // Dynamic import to avoid SSR issues
    interface PolymarketWSMessage {
      type?: string;
      asset_id?: string;
      price?: string | number;
      bids?: Array<{ price: string | number; size: string | number }>;
      asks?: Array<{ price: string | number; size: string | number }>;
    }

    interface KalshiWSMessage {
      msg?: {
        type?: string;
        ticker?: string;
        price?: number;
      };
    }

    if (platform === 'polymarket') {
      import('@/lib/ws/polymarket').then(({ PolymarketWSClient }) => {
        const client = new PolymarketWSClient({
          onMessage: (msg: PolymarketWSMessage) => {
            if (msg.type === 'price_change' && msg.asset_id === marketId) {
              const newPrice = parseFloat(String(msg.price));
              if (!isNaN(newPrice) && book) {
                setBook(prev => prev ? {
                  ...prev,
                  mid: newPrice,
                  timestamp: new Date().toISOString(),
                } : null);
              }
            }
            if (msg.type === 'book' && msg.asset_id === marketId) {
              const bids = (msg.bids || []).map((b) => ({ price: parseFloat(String(b.price)), size: parseFloat(String(b.size)) }));
              const asks = (msg.asks || []).map((a) => ({ price: parseFloat(String(a.price)), size: parseFloat(String(a.size)) }));
              const mid = bids[0] && asks[0] ? (bids[0].price + asks[0].price) / 2 : undefined;
              setBook(prev => prev ? {
                ...prev,
                bids,
                asks,
                mid,
                timestamp: new Date().toISOString(),
              } : null);
            }
          },
          onOpen: () => setIsLive(true),
          onClose: () => setIsLive(false),
        });

        wsRef.current = client;
        client.connect([marketId]);
      });
    } else if (platform === 'kalshi') {
      import('@/lib/ws/kalshi').then(({ KalshiWSClient }) => {
        const client = new KalshiWSClient({
          onMessage: (data: KalshiWSMessage) => {
            // Kalshi WS messages come in different shapes (msg, etc.)
            if (data.msg?.type === 'ticker' && data.msg?.ticker === marketId) {
              const price = data.msg?.price ? data.msg.price / 100 : undefined;
              if (price && book) {
                setBook(prev => prev ? {
                  ...prev,
                  mid: price,
                  timestamp: new Date().toISOString(),
                } : null);
              }
            }
            // Trade messages can also update last price
            if (data.msg?.type === 'trade' && data.msg?.ticker === marketId) {
              const price = data.msg?.price ? data.msg.price / 100 : undefined;
              if (price && book) {
                setBook(prev => prev ? {
                  ...prev,
                  mid: price,
                  timestamp: new Date().toISOString(),
                } : null);
              }
            }
          },
          onOpen: () => setIsLive(true),
          onClose: () => setIsLive(false),
          onError: (err) => console.warn('[Kalshi WS] Error', err),
        });

        wsRef.current = client;
        client.connect([marketId]);
      });
    }
  }

  function handleManualSnipe() {
    if (!book || !marketId) return;

    const price = parseFloat(snipePrice) / 100;
    const size = parseFloat(snipeSize);

    if (!price || !size) {
      alert('Enter valid price and size');
      return;
    }

    const fakeMarket: Market = {
      id: marketId,
      platform: platform as 'polymarket' | 'kalshi',
      externalId: marketId,
      question: `${platform} ${marketId}`,
      status: 'open',
      updatedAt: new Date().toISOString(),
    };

    const fill = paperSimulator.snipe({
      market: fakeMarket,
      side: snipeSide,
      price,
      size,
      reason: `Manual snipe @ ${(price * 100).toFixed(1)}¢`,
    });

    if (fill) {
      setFills(paperSimulator.getFills(20));
      alert(`Paper fill recorded: ${snipeSide} ${size} @ ${(price * 100).toFixed(1)}¢`);
    }
  }

  useEffect(() => {
    loadSnapshot();
    return () => {
      wsRef.current?.disconnect?.();
    };
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <Link href="/markets" className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white mb-6">
        <ArrowLeft className="h-4 w-4" /> Back to all markets
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="uppercase tracking-[2px] text-xs text-zinc-500 mb-1 flex items-center gap-2">
            {platform}
            {isLive && <span className="text-emerald-400 flex items-center gap-1"><Zap className="h-3 w-3" /> LIVE</span>}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight font-mono break-all">{marketId}</h1>
        </div>

        <div className="flex gap-2">
          <button
            onClick={toggleLive}
            className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition ${isLive ? 'border-emerald-500 text-emerald-400' : 'border-white/20 hover:bg-white/5'}`}
          >
            <Zap className="h-4 w-4" /> {isLive ? 'Stop Live' : 'Start Live WS'}
          </button>
          <button onClick={loadSnapshot} disabled={loading} className="flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Snapshot
          </button>
        </div>
      </div>

      {error && <div className="mb-6 rounded-lg border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-400">{error}</div>}

      {/* Live Order Book */}
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <div className="card">
          <div className="flex justify-between items-baseline mb-4">
            <div className="text-emerald-400 font-medium">Bids</div>
            <div className="text-xs text-zinc-500">Price × Size</div>
          </div>
          <div className="space-y-1 font-mono text-sm h-72 overflow-auto">
            {book?.bids.length ? book.bids.slice(0, 15).map((b, i) => (
              <div key={i} className="flex justify-between text-emerald-300/90">
                <span>{(b.price * 100).toFixed(1)}¢</span>
                <span className="text-zinc-400">{b.size.toLocaleString()}</span>
              </div>
            )) : <div className="text-zinc-500">No bids</div>}
          </div>
        </div>

        <div className="card">
          <div className="flex justify-between items-baseline mb-4">
            <div className="text-red-400 font-medium">Asks</div>
            <div className="text-xs text-zinc-500">Price × Size</div>
          </div>
          <div className="space-y-1 font-mono text-sm h-72 overflow-auto">
            {book?.asks.length ? book.asks.slice(0, 15).map((a, i) => (
              <div key={i} className="flex justify-between text-red-300/90">
                <span>{(a.price * 100).toFixed(1)}¢</span>
                <span className="text-zinc-400">{a.size.toLocaleString()}</span>
              </div>
            )) : <div className="text-zinc-500">No asks</div>}
          </div>
        </div>
      </div>

      {book && (
        <div className="text-sm text-zinc-400 mb-8">
          Mid: {book.mid != null ? (book.mid * 100).toFixed(2) + '¢' : '—'} &nbsp;|&nbsp; Spread: {book.spread != null ? (book.spread * 100).toFixed(2) + '%' : '—'}
          <span className="text-xs ml-3 text-zinc-500">Last update: {new Date(book.timestamp).toLocaleTimeString()}</span>
        </div>
      )}

      {/* Manual Paper Snipe (Phase 2 highlight) */}
      <div className="card mb-8">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="text-amber-400" />
          <div className="font-semibold">Paper Snipe (Simulation)</div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <div className="text-xs text-zinc-500 mb-1">Side</div>
            <select value={snipeSide} onChange={e => setSnipeSide(e.target.value as 'BUY' | 'SELL')} className="w-full rounded bg-zinc-950 border border-white/10 px-3 py-2 text-sm">
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
          </div>
          <div>
            <div className="text-xs text-zinc-500 mb-1">Price (¢)</div>
            <input type="number" step="0.1" value={snipePrice} onChange={e => setSnipePrice(e.target.value)} className="w-full rounded bg-zinc-950 border border-white/10 px-3 py-2 font-mono" />
          </div>
          <div>
            <div className="text-xs text-zinc-500 mb-1">Size (shares)</div>
            <input type="number" value={snipeSize} onChange={e => setSnipeSize(e.target.value)} className="w-full rounded bg-zinc-950 border border-white/10 px-3 py-2 font-mono" />
          </div>
          <div className="flex items-end">
            <button
              onClick={handleManualSnipe}
              className="w-full rounded-full bg-white text-black py-2 text-sm font-medium hover:bg-zinc-200 active:bg-white"
            >
              Execute Paper Fill
            </button>
          </div>
          <div className="flex items-end text-xs text-zinc-500">
            Fee model: 5bps (placeholder)
          </div>
        </div>
      </div>

      {/* Recent Paper Fills */}
      {fills.length > 0 && (
        <div className="card">
          <div className="font-medium mb-3">Recent Paper Fills (this session)</div>
          <div className="font-mono text-xs space-y-1">
            {fills.map(f => (
              <div key={f.id} className="flex gap-4 text-zinc-300">
                <span>{new Date(f.timestamp).toLocaleTimeString()}</span>
                <span className={f.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}>{f.side}</span>
                <span>{f.size} @ {(f.price * 100).toFixed(1)}¢</span>
                <span className="text-zinc-500">({f.reason})</span>
              </div>
            ))}
          </div>
          <div className="text-[10px] text-zinc-500 mt-3">Fills are in-memory for this browser session. Full persistence + strategy automation in Phase 3.</div>
        </div>
      )}

      <div className="mt-8 card">
        <button
          onClick={async () => {
            const res = await fetch('/api/grok/intel', {
              method: 'POST',
              body: JSON.stringify({ marketQuestion: `${platform} ${marketId}`, currentPrice: book?.mid }),
            });
            const data = await res.json();
            alert(data.analysis || data.error);
          }}
          className="text-sm underline"
        >
          Ask Grok for quick market intel (requires XAI_API_KEY)
        </button>
      </div>

      <div className="mt-6 text-xs text-zinc-500">
        Phase 2-4 complete. Real execution + 24/7 runner + risk engine live. Grok intel is a bonus.
      </div>
    </div>
  );
}
