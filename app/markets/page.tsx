'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, TrendingUp } from 'lucide-react';
import type { Market } from '@/lib/types';

export default function MarketsPage() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState<'all' | 'polymarket' | 'kalshi'>('all');

  async function loadMarkets(force = false) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/markets${force ? '?force=true' : ''}`);
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setMarkets(data.markets ?? []);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch markets');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMarkets();
  }, []);

  const filtered = markets
    .filter(m => {
      if (platformFilter !== 'all' && m.platform !== platformFilter) return false;
      if (search && !m.question.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .slice(0, 80);

  return (
    <div className="max-w-7xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <Link href="/dashboard" className="text-sm flex items-center gap-2 text-zinc-400 hover:text-white mb-2">
            <ArrowLeft className="h-4 w-4" /> Back to Dashboard
          </Link>
          <h1 className="text-4xl font-semibold tracking-tight">Markets</h1>
          <p className="text-zinc-400 mt-1">Live discovery from Polymarket &amp; Kalshi (public data)</p>
        </div>
        <button
          onClick={() => loadMarkets(true)}
          disabled={loading}
          className="flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <input
          type="text"
          placeholder="Search markets..."
          className="flex-1 rounded-lg border border-white/10 bg-zinc-900 px-4 py-2 text-sm focus:outline-none focus:border-white/30"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          value={platformFilter}
          onChange={(e) => setPlatformFilter(e.target.value as any)}
          className="rounded-lg border border-white/10 bg-zinc-900 px-4 py-2 text-sm focus:outline-none"
        >
          <option value="all">All Platforms</option>
          <option value="polymarket">Polymarket only</option>
          <option value="kalshi">Kalshi only</option>
        </select>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left">
              <th className="table-header px-4 py-3">Platform</th>
              <th className="table-header px-4 py-3">Question</th>
              <th className="table-header px-4 py-3 text-right">Last Price</th>
              <th className="table-header px-4 py-3 text-right">Volume</th>
              <th className="table-header px-4 py-3 text-right">Liquidity</th>
              <th className="table-header px-4 py-3 w-12"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {loading && markets.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-zinc-500">Loading markets…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-12 text-center text-zinc-500">No markets match your filters.</td></tr>
            ) : (
              filtered.map((m) => (
                <tr key={`${m.platform}-${m.externalId}`} className="hover:bg-white/5 transition-colors group">
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded px-2 py-0.5 text-[10px] font-medium tracking-wider uppercase ${m.platform === 'polymarket' ? 'bg-blue-950 text-blue-400' : 'bg-emerald-950 text-emerald-400'}`}>
                      {m.platform}
                    </span>
                  </td>
                  <td className="px-4 py-3 pr-8 text-zinc-200 group-hover:text-white line-clamp-2">{m.question}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {m.lastPrice != null ? (m.lastPrice * 100).toFixed(1) + '¢' : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-zinc-400 tabular-nums">
                    {m.volume != null ? '$' + Math.round(m.volume).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-zinc-400 tabular-nums">
                    {m.liquidity != null ? '$' + Math.round(m.liquidity).toLocaleString() : '—'}
                  </td>
                  <td className="px-2 py-3 text-right">
                    <Link
                      href={`/markets/${m.platform}/${encodeURIComponent(m.externalId)}`}
                      className="opacity-60 hover:opacity-100 transition flex justify-end"
                    >
                      <TrendingUp className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-6 text-xs text-zinc-500">
        Data is public + cached ~25s. Order book details available on individual market pages (Phase 1+).
      </div>
    </div>
  );
}
