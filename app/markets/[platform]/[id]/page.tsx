'use client';

import { useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, Zap, TrendingUp, Sparkles } from 'lucide-react';
import type { OrderBook } from '@/lib/types';
import { getErrorMessage } from '@/lib/error-message';
import type { PolymarketWSClient, PolymarketWSMessage, ClobBookLevel } from '@/lib/ws/polymarket';

interface MarketMeta {
  question: string;
  lastPrice?: number;
  volume?: number;
  liquidity?: number;
}

interface Props {
  params: Promise<{ platform: string; id: string }>;
}

export default function LiveMarketDetail({ params }: Props) {
  const [book, setBook] = useState<OrderBook | null>(null);
  const [market, setMarket] = useState<MarketMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [platform, setPlatform] = useState<string>('');
  const [marketId, setMarketId] = useState<string>('');
  const [isLive, setIsLive] = useState(false);
  const [fills, setFills] = useState<Array<{
    id: string;
    side: 'BUY' | 'SELL';
    price: number;
    size: number;
    reason: string;
    timestamp: string;
  }>>([]);
  const [snipePrice, setSnipePrice] = useState('');
  const [snipeSize, setSnipeSize] = useState('100');
  const [snipeSide, setSnipeSide] = useState<'BUY' | 'SELL'>('BUY');
  const [snipeError, setSnipeError] = useState<string | null>(null);
  const [snipeLoading, setSnipeLoading] = useState(false);
  const [grokAnalysis, setGrokAnalysis] = useState<string | null>(null);
  const [grokLoading, setGrokLoading] = useState(false);
  const [grokError, setGrokError] = useState<string | null>(null);
  const [grokConfigured, setGrokConfigured] = useState<boolean | null>(null);

  const wsRef = useRef<PolymarketWSClient | null>(null);

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
      if (data.market) setMarket(data.market);

      const defaultPrice = data.mid ?? data.market?.lastPrice;
      if (!snipePrice && defaultPrice != null) {
        setSnipePrice((defaultPrice * 100).toFixed(1));
      }
    } catch (e: unknown) {
      setError(getErrorMessage(e) || 'Failed to load order book');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const p = await params;
      if (cancelled) return;
      setPlatform(p.platform);
      setMarketId(p.id);
      setError(null);

      try {
        const res = await fetch(`/api/markets/orderbook?platform=${p.platform}&id=${encodeURIComponent(p.id)}`);
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        if (cancelled) return;
        setBook(data);
        if (data.market) setMarket(data.market);

        const defaultPrice = data.mid ?? data.market?.lastPrice;
        if (defaultPrice != null) {
          setSnipePrice(prev => prev || (defaultPrice * 100).toFixed(1));
        }
      } catch (e: unknown) {
        if (!cancelled) setError(getErrorMessage(e) || 'Failed to load order book');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    void fetch('/api/settings')
      .then(r => r.json())
      .then(d => setGrokConfigured(d.xaiConfigured))
      .catch(() => setGrokConfigured(false));

    return () => {
      cancelled = true;
      wsRef.current?.disconnect?.();
    };
  }, [params]);

  function toggleLive() {
    if (isLive) {
      wsRef.current?.disconnect?.();
      setIsLive(false);
      return;
    }

    if (platform !== 'polymarket') {
      alert('Live WS currently demoed on Polymarket only in Phase 2. Kalshi support coming next.');
      return;
    }

    import('@/lib/ws/polymarket').then(({ PolymarketWSClient }) => {
      const client = new PolymarketWSClient({
        onMessage: (msg: PolymarketWSMessage) => {
          if ('type' in msg && msg.type === 'price_change' && msg.asset_id === marketId) {
            const newPrice = parseFloat(msg.price);
            if (!isNaN(newPrice)) {
              setBook(prev => prev ? { ...prev, mid: newPrice, timestamp: new Date().toISOString() } : null);
            }
          }
          if ('type' in msg && msg.type === 'book' && msg.asset_id === marketId) {
            const bids = (msg.bids || []).map((b: ClobBookLevel) => ({ price: parseFloat(b.price), size: parseFloat(b.size) }))
              .sort((a, b) => b.price - a.price);
            const asks = (msg.asks || []).map((a: ClobBookLevel) => ({ price: parseFloat(a.price), size: parseFloat(a.size) }))
              .sort((a, b) => a.price - b.price);
            const mid = bids[0] && asks[0] ? (bids[0].price + asks[0].price) / 2 : undefined;
            const spread = bids[0] && asks[0] ? asks[0].price - bids[0].price : undefined;
            setBook(prev => prev ? { ...prev, bids, asks, mid, spread, timestamp: new Date().toISOString() } : null);
          }
        },
        onOpen: () => setIsLive(true),
        onClose: () => setIsLive(false),
      });

      wsRef.current = client;
      client.connect([marketId]);
    });
  }

  async function handleManualSnipe() {
    if (!marketId || !platform) return;

    const price = parseFloat(snipePrice) / 100;
    const size = parseFloat(snipeSize);

    if (!price || !size || price <= 0 || price >= 1) {
      setSnipeError('Enter a valid price (1–99¢) and size');
      return;
    }

    setSnipeLoading(true);
    setSnipeError(null);

    try {
      const res = await fetch('/api/paper/fill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          marketExternalId: marketId,
          side: snipeSide,
          price,
          size,
          reason: `Manual snipe @ ${(price * 100).toFixed(1)}¢`,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setSnipeError(data.error || 'Fill failed');
        return;
      }

      setFills(prev => [data.fill, ...prev].slice(0, 20));
    } catch (e: unknown) {
      setSnipeError(getErrorMessage(e) || 'Failed to execute paper fill');
    } finally {
      setSnipeLoading(false);
    }
  }

  async function askGrok() {
    if (!grokConfigured) return;

    setGrokLoading(true);
    setGrokError(null);
    setGrokAnalysis(null);

    try {
      const res = await fetch('/api/grok/intel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketQuestion: market?.question ?? `${platform} market`,
          currentPrice: book?.mid ?? market?.lastPrice,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGrokError(data.error || 'Grok request failed');
        return;
      }
      setGrokAnalysis(data.analysis);
    } catch (e: unknown) {
      setGrokError(getErrorMessage(e) || 'Grok request failed');
    } finally {
      setGrokLoading(false);
    }
  }

  const displayPrice = book?.mid ?? market?.lastPrice;

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <Link href="/markets" className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white mb-6">
        <ArrowLeft className="h-4 w-4" /> Back to all markets
      </Link>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="min-w-0 flex-1">
          <div className="uppercase tracking-[2px] text-xs text-zinc-500 mb-1 flex items-center gap-2">
            {platform}
            {isLive && <span className="text-emerald-400 flex items-center gap-1"><Zap className="h-3 w-3" /> LIVE</span>}
          </div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight leading-snug">
            {market?.question ?? 'Loading market…'}
          </h1>
          <div className="mt-2 text-xs text-zinc-500 font-mono truncate" title={marketId}>
            {marketId}
          </div>
        </div>

        <div className="flex gap-2 shrink-0">
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
          Last price: {displayPrice != null ? (displayPrice * 100).toFixed(2) + '¢' : '—'}
          &nbsp;|&nbsp; Mid: {book.mid != null ? (book.mid * 100).toFixed(2) + '¢' : '—'}
          &nbsp;|&nbsp; Spread: {book.spread != null ? (book.spread * 100).toFixed(2) + '¢' : '—'}
          <span className="text-xs ml-3 text-zinc-500">Last update: {new Date(book.timestamp).toLocaleTimeString()}</span>
        </div>
      )}

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
              disabled={snipeLoading}
              className="w-full rounded-full bg-white text-black py-2 text-sm font-medium hover:bg-zinc-200 active:bg-white disabled:opacity-50"
            >
              {snipeLoading ? 'Executing…' : 'Execute Paper Fill'}
            </button>
          </div>
          <div className="flex items-end text-xs text-zinc-500">
            Fee model: 5bps
          </div>
        </div>
        {snipeError && (
          <div className="mt-3 text-sm text-red-400">{snipeError}</div>
        )}
      </div>

      {fills.length > 0 && (
        <div className="card mb-8">
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
        </div>
      )}

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-violet-400" />
            <div className="font-semibold">Grok Market Intel</div>
          </div>
          {grokConfigured === false && (
            <Link href="/settings" className="text-xs text-violet-400 hover:text-violet-300 underline">
              Add API key in Settings →
            </Link>
          )}
        </div>

        {grokConfigured === false ? (
          <p className="text-sm text-zinc-400">
            Add your xAI API key in <Link href="/settings" className="underline hover:text-white">Settings</Link> to get AI analysis of this market.
          </p>
        ) : (
          <>
            <button
              onClick={askGrok}
              disabled={grokLoading}
              className="rounded-full border border-white/20 px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-50"
            >
              {grokLoading ? 'Analyzing…' : 'Ask Grok for analysis'}
            </button>
            {grokError && <div className="mt-3 text-sm text-red-400">{grokError}</div>}
            {grokAnalysis && (
              <div className="mt-4 text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed border-t border-white/10 pt-4">
                {grokAnalysis}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
