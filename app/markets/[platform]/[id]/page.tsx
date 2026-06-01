'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import type { OrderBook } from '@/lib/types';

interface Props {
  params: Promise<{ platform: string; id: string }>;
}

export default function MarketDetail({ params }: Props) {
  const [book, setBook] = useState<OrderBook | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [platform, setPlatform] = useState<string>('');
  const [id, setId] = useState<string>('');

  async function load() {
    const p = await params;
    setPlatform(p.platform);
    setId(p.id);

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/markets/orderbook?platform=${p.platform}&id=${encodeURIComponent(p.id)}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setBook(data);
    } catch (e: any) {
      setError(e.message || 'Failed to load order book');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <Link href="/markets" className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white mb-6">
        <ArrowLeft className="h-4 w-4" /> Back to all markets
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="uppercase tracking-[2px] text-xs text-zinc-500 mb-1">{platform}</div>
          <h1 className="text-3xl font-semibold tracking-tight font-mono break-all">{id}</h1>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh Book
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-400">{error}</div>
      )}

      {!book && loading && <div className="text-zinc-500">Loading order book…</div>}

      {book && (
        <div className="grid md:grid-cols-2 gap-6">
          {/* Bids */}
          <div className="card">
            <div className="flex justify-between items-baseline mb-4">
              <div className="text-emerald-400 font-medium">Bids</div>
              <div className="text-xs text-zinc-500">Price × Size</div>
            </div>
            <div className="space-y-1 font-mono text-sm">
              {book.bids.length ? book.bids.slice(0, 12).map((b, i) => (
                <div key={i} className="flex justify-between text-emerald-300/90">
                  <span>{(b.price * 100).toFixed(1)}¢</span>
                  <span className="text-zinc-400">{b.size.toLocaleString()}</span>
                </div>
              )) : <div className="text-zinc-500">No bids</div>}
            </div>
          </div>

          {/* Asks */}
          <div className="card">
            <div className="flex justify-between items-baseline mb-4">
              <div className="text-red-400 font-medium">Asks</div>
              <div className="text-xs text-zinc-500">Price × Size</div>
            </div>
            <div className="space-y-1 font-mono text-sm">
              {book.asks.length ? book.asks.slice(0, 12).map((a, i) => (
                <div key={i} className="flex justify-between text-red-300/90">
                  <span>{(a.price * 100).toFixed(1)}¢</span>
                  <span className="text-zinc-400">{a.size.toLocaleString()}</span>
                </div>
              )) : <div className="text-zinc-500">No asks</div>}
            </div>
          </div>
        </div>
      )}

      {book && (
        <div className="mt-6 text-sm text-zinc-400">
          Mid: {book.mid != null ? (book.mid * 100).toFixed(2) + '¢' : '—'} &nbsp;|&nbsp; Spread: {book.spread != null ? (book.spread * 100).toFixed(2) + '%' : '—'}
          <div className="text-xs mt-1 text-zinc-500">Snapshot at {new Date(book.timestamp).toLocaleTimeString()}</div>
        </div>
      )}

      <div className="mt-10 text-xs text-zinc-500 max-w-prose">
        Phase 1 demo. Real-time WebSocket updates, better depth, and strategy signals arrive in later phases.
        This view proves the unified client layer works for both platforms.
      </div>
    </div>
  );
}
