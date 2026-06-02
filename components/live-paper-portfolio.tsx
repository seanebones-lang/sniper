'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Radio, ExternalLink } from 'lucide-react';

export interface LivePortfolioData {
  updatedAt: string;
  runner: {
    running: boolean;
    lastRun: string | null;
    lastRunAgeSeconds: number | null;
    signalsGenerated: number;
    fillsExecuted: number;
    dbPaperFillsTotal: number;
    dbPaperFillsToday: number;
    activeStrategies: number;
  };
  budget: {
    paperBudgetUsd: number;
    maxExposureUsd: number;
    totalExposureUsd: number;
    availableUsd: number;
    totalFeesUsd: number;
    utilizationPct: number;
  };
  positions: Array<{
    platform: string;
    marketExternalId: string;
    netSize: number;
    avgPrice: number;
    notionalUsd: number;
    side: 'LONG' | 'SHORT';
  }>;
  recentFills: Array<{
    id: string;
    platform: string;
    marketExternalId: string;
    side: string;
    price: number;
    size: number;
    filledAt: string;
    strategyName: string | null;
  }>;
  performance?: {
    buyFills: number;
    sellFills: number;
  };
  runSession?: {
    startedAt: string | null;
    fillsInRun: number;
  };
}

interface LivePaperPortfolioProps {
  /** Poll interval in ms (default 3000) */
  pollMs?: number;
  /** Max positions rows to show */
  maxPositions?: number;
  /** Max recent fills to show */
  maxFills?: number;
  showHeader?: boolean;
}

export function LivePaperPortfolio({
  pollMs = 3000,
  maxPositions = 12,
  maxFills = 8,
  showHeader = true,
}: LivePaperPortfolioProps) {
  const [data, setData] = useState<LivePortfolioData | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch('/api/paper/portfolio?days=1', { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load portfolio');
        const json = await res.json();
        if (cancelled) return;
        setData({ ...json, updatedAt: new Date().toISOString() });
        setLastFetch(new Date());
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Load failed');
      }
    }

    void tick();
    const interval = setInterval(() => { void tick(); }, pollMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pollMs]);

  const positions = data?.positions.slice(0, maxPositions) ?? [];
  const fills = data?.recentFills.slice(0, maxFills) ?? [];

  return (
    <div className="card border-emerald-500/20">
      {showHeader && (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-2">
            <Radio className={`h-4 w-4 ${data?.runner.running ? 'text-emerald-400 animate-pulse' : 'text-zinc-500'}`} />
            <h2 className="font-semibold text-lg">Live Paper Portfolio</h2>
            {lastFetch && (
              <span className="text-xs text-zinc-500">
                live · {lastFetch.toLocaleTimeString()}
              </span>
            )}
            {data?.runSession?.startedAt && (
              <span className="text-xs text-amber-400/90 w-full sm:w-auto">
                run since {new Date(data.runSession.startedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
          <Link
            href="/paper"
            className="text-xs flex items-center gap-1 text-emerald-400 hover:text-white underline"
          >
            Full portfolio &amp; budget <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      )}

      {error && (
        <p className="text-sm text-red-400 mb-4">{error}</p>
      )}

      {!data && !error && (
        <p className="text-sm text-zinc-500">Loading live portfolio…</p>
      )}

      {data && (
        <>
          {/* Portfolio summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5 text-sm">
            <div>
              <div className="text-xs text-zinc-500 mb-0.5">Open exposure</div>
              <div className="font-mono font-semibold text-lg">
                ${data.budget.totalExposureUsd.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500 mb-0.5">Available</div>
              <div className="font-mono font-semibold text-lg">
                ${data.budget.availableUsd.toFixed(2)}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500 mb-0.5">Positions</div>
              <div className="font-mono font-semibold text-lg">{data.positions.length}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500 mb-0.5">Buys / Sells (1d)</div>
              <div className="font-mono font-semibold text-lg">
                <span className="text-emerald-400">{data.performance?.buyFills ?? 0}</span>
                {' / '}
                <span className="text-red-400">{data.performance?.sellFills ?? 0}</span>
              </div>
            </div>
          </div>

          <div className="mb-5">
            <div className="flex justify-between text-xs text-zinc-500 mb-1">
              <span>Exposure vs limit (${data.budget.maxExposureUsd.toLocaleString()})</span>
              <span>{data.budget.utilizationPct.toFixed(0)}%</span>
            </div>
            <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  data.budget.utilizationPct > 85 ? 'bg-amber-500' : 'bg-emerald-500'
                }`}
                style={{ width: `${Math.min(100, data.budget.utilizationPct)}%` }}
              />
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            {/* Positions */}
            <div>
              <div className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">
                Open positions ({data.positions.length})
              </div>
              {positions.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  No open positions. Start the runner with active strategies to paper-trade.
                </p>
              ) : (
                <div className="overflow-x-auto max-h-56 overflow-y-auto rounded-lg border border-white/5">
                  <table className="w-full text-xs font-mono">
                    <thead className="sticky top-0 bg-zinc-900">
                      <tr className="text-zinc-500 text-left border-b border-white/10">
                        <th className="p-2">Market</th>
                        <th className="p-2">Side</th>
                        <th className="p-2">Size</th>
                        <th className="p-2">Avg</th>
                        <th className="p-2">$</th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((p) => (
                        <tr key={`${p.platform}:${p.marketExternalId}`} className="border-b border-white/5 hover:bg-white/5">
                          <td className="p-2 max-w-[120px] truncate">
                            <Link
                              href={`/markets/${p.platform}/${p.marketExternalId}`}
                              className="underline hover:text-white"
                            >
                              {p.marketExternalId.slice(0, 10)}…
                            </Link>
                          </td>
                          <td className={`p-2 ${p.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>
                            {p.side}
                          </td>
                          <td className="p-2">{p.netSize.toFixed(1)}</td>
                          <td className="p-2">{(p.avgPrice * 100).toFixed(1)}¢</td>
                          <td className="p-2">${p.notionalUsd.toFixed(0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {data.positions.length > maxPositions && (
                <p className="text-xs text-zinc-500 mt-1">
                  +{data.positions.length - maxPositions} more on{' '}
                  <Link href="/paper" className="underline">Paper Portfolio</Link>
                </p>
              )}
            </div>

            {/* Recent fills feed */}
            <div>
              <div className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2">
                Live fill feed
              </div>
              {fills.length === 0 ? (
                <p className="text-sm text-zinc-500">No fills yet today.</p>
              ) : (
                <div className="space-y-1 max-h-56 overflow-y-auto font-mono text-xs">
                  {fills.map((f) => (
                    <div
                      key={f.id}
                      className="flex flex-wrap gap-2 py-1.5 px-2 rounded border border-white/5 bg-zinc-950/50"
                    >
                      <span className="text-zinc-500">{new Date(f.filledAt).toLocaleTimeString()}</span>
                      <span className={f.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}>{f.side}</span>
                      <span>{f.size.toFixed(0)} @ {(f.price * 100).toFixed(1)}¢</span>
                      {f.strategyName && (
                        <span className="text-violet-400 truncate">{f.strategyName}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {data.runner.running && (
            <p className="text-xs text-zinc-500 mt-4">
              Runner active · session {data.runner.signalsGenerated} signals / {data.runner.fillsExecuted} fills
              {data.runner.lastRun && (
                <> · last cycle {new Date(data.runner.lastRun).toLocaleTimeString()}</>
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}
