'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Play,
  Square,
  Wallet,
  TrendingUp,
  Activity,
  RefreshCw,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { PaperPnlIndicator } from '@/components/paper-pnl-indicator';

interface PortfolioData {
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
    maxDailyLossUsd: number;
    totalExposureUsd: number;
    availableUsd: number;
    cashUsd: number;
    totalEquityUsd: number;
    netPnlUsd: number;
    netPnlPct: number;
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
    fee: number;
    filledAt: string;
    strategyName: string | null;
  }>;
  performance: {
    periodDays: number;
    totalSignals: number;
    totalFills: number;
    byStrategy: Array<{
      strategyId: string;
      name: string;
      signals: number;
      fills: number;
      notionalUsd: number;
      isActive: boolean;
    }>;
  };
  runSession?: {
    startedAt: string | null;
    fillsInRun: number;
  };
  pnl?: import('@/lib/paper/portfolio').PaperPnlSnapshot;
  live?: {
    armed: boolean;
    polymarketUsdcBalance: number | null;
    polymarketReady: boolean;
    geoblockBlocked: boolean;
    note: string;
  };
}

export default function PaperPortfolioPage() {
  const [data, setData] = useState<PortfolioData | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingBudget, setSavingBudget] = useState(false);
  const [budgetForm, setBudgetForm] = useState({
    paperBudgetUsd: 10000,
    maxExposureUsd: 2000,
    maxDailyLossUsd: 150,
  });

  const load = useCallback(async () => {
    const res = await fetch('/api/paper/portfolio?days=7');
    if (res.ok) {
      const json = await res.json();
      setData(json);
      setBudgetForm({
        paperBudgetUsd: json.budget.paperBudgetUsd,
        maxExposureUsd: json.budget.maxExposureUsd,
        maxDailyLossUsd: json.budget.maxDailyLossUsd ?? 150,
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchPortfolio() {
      const res = await fetch('/api/paper/portfolio?days=7');
      if (!res.ok || cancelled) return;
      const json = await res.json();
      if (cancelled) return;
      setData(json);
      setBudgetForm({
        paperBudgetUsd: json.budget.paperBudgetUsd,
        maxExposureUsd: json.budget.maxExposureUsd,
        maxDailyLossUsd: json.budget.maxDailyLossUsd ?? 150,
      });
      setLoading(false);
    }

    void fetchPortfolio();
    const interval = setInterval(() => { void fetchPortfolio(); }, 8000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function startNewRun() {
    if (!confirm(
      'Start a new paper run? The dashboard will reset to zero — old fills stay in the database for backtests.',
    )) {
      return;
    }
    const res = await fetch('/api/paper/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'new' }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error || 'Failed to start new run');
      return;
    }
    toast.success('New paper run started — counters and positions cleared');
    if (json.portfolio) setData(json.portfolio);
    else void load();
  }

  async function controlRunner(action: 'start' | 'stop') {
    const res = await fetch('/api/runner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error || 'Failed to control runner');
      return;
    }
    toast.success(action === 'start' ? 'Paper runner started' : 'Paper runner stopped');
    setData((prev) => prev ? {
      ...prev,
      runner: {
        ...prev.runner,
        running: json.running ?? action === 'start',
        lastRun: json.lastRun ?? prev.runner.lastRun,
        signalsGenerated: json.signalsGenerated ?? prev.runner.signalsGenerated,
        fillsExecuted: json.fillsExecuted ?? prev.runner.fillsExecuted,
        lastRunAgeSeconds: json.lastRunAgeSeconds ?? null,
      },
    } : prev);
    void load();
  }

  async function saveBudget() {
    setSavingBudget(true);
    try {
      const res = await fetch('/api/paper/portfolio', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(budgetForm),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          typeof json.error === 'string'
            ? json.error
            : JSON.stringify(json.error ?? json) || 'Failed to save budget',
        );
        return;
      }
      toast.success(json.note ? 'Budget saved' : 'Paper budget saved');
      void load();
    } finally {
      setSavingBudget(false);
    }
  }

  const runner = data?.runner;
  const stale = runner?.running && runner.lastRunAgeSeconds != null && runner.lastRunAgeSeconds > 30;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white mb-6">
        <ArrowLeft className="h-4 w-4" /> Back to Dashboard
      </Link>

      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4 mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Wallet className="h-8 w-8 text-emerald-400" />
            <h1 className="text-4xl font-semibold tracking-tight">Paper Portfolio</h1>
          </div>
          <p className="text-zinc-400">
            Live runner status, open positions, performance, and budget
            {data?.runSession?.startedAt && (
              <span className="block text-xs text-emerald-500/80 mt-1">
                Current run since {new Date(data.runSession.startedAt).toLocaleString()}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => void startNewRun()}
            className="flex items-center gap-2 rounded-full border border-amber-500/50 text-amber-300 px-4 py-2 text-sm hover:bg-amber-500/10"
            title="Clear UI counters and positions for a fresh run (database unchanged)"
          >
            <RotateCcw className="h-4 w-4" /> New Run
          </button>
          <button
            onClick={() => void load()}
            className="flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-sm hover:bg-white/5"
          >
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <button
            onClick={() => controlRunner(runner?.running ? 'stop' : 'start')}
            className={`flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium border transition ${
              runner?.running ? 'border-red-500 text-red-400' : 'border-emerald-500 text-emerald-400'
            }`}
          >
            {runner?.running ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {runner?.running ? 'Stop Runner' : 'Start Runner'}
          </button>
          <Link
            href="/strategies"
            className="rounded-full bg-white text-black px-5 py-2 text-sm font-medium hover:bg-zinc-200"
          >
            Manage Strategies
          </Link>
        </div>
      </div>

      {loading && !data && <div className="text-zinc-500 text-sm">Loading portfolio…</div>}

      {data?.live?.armed && (
        <div className="card border-red-500/40 bg-red-950/25 mb-6">
          <div className="text-red-300 font-semibold mb-1">Live Polymarket (real money)</div>
          <p className="text-xs text-zinc-500 mb-2">{data.live.note}</p>
          <div className="text-3xl font-mono text-white">
            {data.live.polymarketUsdcBalance != null
              ? `$${data.live.polymarketUsdcBalance.toFixed(2)}`
              : '—'}
            <span className="text-sm text-zinc-500 ml-2">CLOB cash</span>
          </div>
          <p className={`text-xs mt-2 ${data.live.polymarketReady ? 'text-emerald-400' : 'text-amber-400'}`}>
            Trading path: {data.live.polymarketReady ? 'ready' : 'not ready'}
            {data.live.geoblockBlocked ? ' · geoblock — set proxy on /real' : ''}
          </p>
          <p className="text-xs text-zinc-600 mt-2">
            Paper bankroll settings below do <strong className="text-zinc-400">not</strong> control live order size
            (~$1/trade from strategy). Use them only for paper simulation.
          </p>
        </div>
      )}

      {data && (
        <>
          <div className="card border-emerald-500/30 bg-emerald-950/15 mb-6">
            <div className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Paper simulation bankroll</div>
            <div className="text-3xl font-mono font-semibold text-emerald-300">
              ${data.budget.paperBudgetUsd.toLocaleString()}
            </div>
            <p className="text-xs text-zinc-500 mt-2">
              Total equity ${data.budget.totalEquityUsd.toFixed(2)} · max exposure ${data.budget.maxExposureUsd.toLocaleString()}
              {data.budget.paperBudgetUsd < 100 && (
                <span className="text-amber-400"> · This looks like a micro-test budget — use &quot;Reset defaults&quot; below for $10k paper simulation.</span>
              )}
            </p>
          </div>

          {/* Runner status */}
          <div className={`card mb-6 ${stale ? 'border-amber-500/40' : ''}`}>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <div>
                <span className="text-zinc-500">Runner </span>
                <span className={runner?.running ? 'text-emerald-400 font-medium' : 'text-zinc-500 font-medium'}>
                  {runner?.running ? 'RUNNING' : 'STOPPED'}
                </span>
              </div>
              <div>
                <span className="text-zinc-500">Active strategies </span>
                <span className="font-mono">{runner?.activeStrategies ?? 0}</span>
              </div>
              <div>
                <span className="text-zinc-500">Last cycle </span>
                <span className="font-mono">
                  {runner?.lastRun ? new Date(runner.lastRun).toLocaleTimeString() : 'never'}
                </span>
              </div>
              <div>
                <span className="text-zinc-500">Session signals / DB fills </span>
                <span className="font-mono">{runner?.signalsGenerated} / {runner?.dbPaperFillsTotal}</span>
              </div>
            </div>
            {!runner?.running && (runner?.activeStrategies ?? 0) > 0 && (
              <p className="mt-3 text-amber-300 text-sm">
                You have {runner?.activeStrategies} active strategies but the runner is stopped.
                Click <strong>Start Runner</strong> above — strategies only trade while the runner is running.
              </p>
            )}
            {runner?.running && stale && (
              <p className="mt-3 text-amber-300 text-sm">
                Runner appears stale (no cycle in {runner.lastRunAgeSeconds}s). Try stopping and restarting it.
              </p>
            )}
            {runner?.running && runner.fillsExecuted === 0 && runner.signalsGenerated > 0 && (
              <p className="mt-3 text-zinc-400 text-sm">
                Signals are firing but no fills this session — spreads may not meet thresholds, or exposure limits may be capping size.
              </p>
            )}
          </div>

          {data.pnl && (
            <PaperPnlIndicator pnl={data.pnl} variant="hero" className="mb-8" />
          )}

          {/* Budget + summary */}
          <div className="grid lg:grid-cols-3 gap-6 mb-8">
            <div className="card lg:col-span-2">
              <div className="font-semibold mb-4 flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-emerald-400" /> Budget &amp; exposure
              </div>
              <div className="grid sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-xs text-zinc-500 block mb-1">
                    Paper bankroll (USD){data.live?.armed ? ' — simulation only' : ''}
                  </label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={budgetForm.paperBudgetUsd}
                    onChange={(e) => setBudgetForm({ ...budgetForm, paperBudgetUsd: Number(e.target.value) })}
                    className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-500 block mb-1">Max open exposure (USD)</label>
                  <input
                    type="number"
                    value={budgetForm.maxExposureUsd}
                    onChange={(e) => setBudgetForm({ ...budgetForm, maxExposureUsd: Number(e.target.value) })}
                    className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono"
                  />
                </div>
              </div>
              <button
                onClick={() => void saveBudget()}
                disabled={savingBudget}
                className="rounded-full bg-white text-black px-5 py-2 text-sm font-medium hover:bg-zinc-200 disabled:opacity-50"
              >
                {savingBudget ? 'Saving…' : 'Save budget'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setBudgetForm({
                    paperBudgetUsd: 10000,
                    maxExposureUsd: 2000,
                    maxDailyLossUsd: 150,
                  });
                }}
                className="ml-3 rounded-full border border-white/20 px-5 py-2 text-sm hover:bg-white/5"
              >
                Reset defaults ($10k)
              </button>
              <p className="text-xs text-zinc-500 mt-3">
                Caps paper simulation sizing (saved to database).
                {data.live?.armed && data.live.polymarketUsdcBalance != null && (
                  <> Live Polymarket wallet is ${data.live.polymarketUsdcBalance.toFixed(2)} — separate from this paper bankroll.</>
                )}
              </p>
            </div>

            <div className="card space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-500">Total equity</span>
                <span className={`font-mono font-semibold ${data.budget.netPnlUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  ${data.budget.totalEquityUsd.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Net P&amp;L (vs ${data.budget.paperBudgetUsd.toLocaleString()} start)</span>
                <span className={`font-mono ${data.budget.netPnlUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {data.budget.netPnlUsd >= 0 ? '+' : ''}{data.budget.netPnlUsd.toFixed(2)} ({data.budget.netPnlPct.toFixed(2)}%)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Cash available</span>
                <span className="font-mono">${data.budget.availableUsd.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-500">Open exposure (mark)</span>
                <span className="font-mono">${data.budget.totalExposureUsd.toFixed(2)}</span>
              </div>
              {data.pnl && (
                <div className="flex justify-between">
                  <span className="text-zinc-500">Open cost basis</span>
                  <span className="font-mono">${data.pnl.openCostBasisUsd.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-zinc-500">Exposure utilization</span>
                <span className="font-mono">{data.budget.utilizationPct.toFixed(0)}%</span>
              </div>
              <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${Math.min(100, data.budget.utilizationPct)}%` }}
                />
              </div>
              <div className="flex justify-between pt-2 border-t border-white/10">
                <span className="text-zinc-500">Fees (this run)</span>
                <span className="font-mono">${data.budget.totalFeesUsd.toFixed(2)}</span>
              </div>
              <p className="text-[11px] text-zinc-600 leading-relaxed pt-1">
                Total equity includes cash from closed trades. The old &quot;available&quot; line ignored sell proceeds.
              </p>
            </div>
          </div>

          {/* Strategy performance */}
          <div className="card mb-8">
            <div className="font-semibold mb-4 flex items-center gap-2">
              <Activity className="h-5 w-5 text-violet-400" />
              Strategy performance ({data.performance.periodDays}d)
            </div>
            {data.performance.byStrategy.length === 0 ? (
              <p className="text-sm text-zinc-500">No strategy activity yet. Activate strategies and start the runner.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-zinc-500 text-left border-b border-white/10">
                      <th className="pb-2 pr-4">Strategy</th>
                      <th className="pb-2 pr-4">Status</th>
                      <th className="pb-2 pr-4">Signals</th>
                      <th className="pb-2 pr-4">Fills</th>
                      <th className="pb-2">Notional</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.performance.byStrategy.map((s) => (
                      <tr key={s.strategyId} className="border-b border-white/5">
                        <td className="py-2 pr-4">{s.name}</td>
                        <td className="py-2 pr-4">
                          <span className={s.isActive ? 'text-emerald-400' : 'text-zinc-500'}>
                            {s.isActive ? 'ACTIVE' : 'paused'}
                          </span>
                        </td>
                        <td className="py-2 pr-4 font-mono">{s.signals}</td>
                        <td className="py-2 pr-4 font-mono">{s.fills}</td>
                        <td className="py-2 font-mono">${s.notionalUsd.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-xs text-zinc-500 mt-3">
              Totals: {data.performance.totalSignals} signals · {data.performance.totalFills} paper fills
            </p>
          </div>

          {/* Positions */}
          <div className="card mb-8">
            <div className="font-semibold mb-4">Open positions ({data.positions.length})</div>
            {data.positions.length === 0 ? (
              <p className="text-sm text-zinc-500">No open paper positions — fills will appear here after the runner trades.</p>
            ) : (
              <div className="overflow-x-auto font-mono text-xs">
                <table className="w-full">
                  <thead>
                    <tr className="text-zinc-500 text-left border-b border-white/10">
                      <th className="pb-2 pr-3">Platform</th>
                      <th className="pb-2 pr-3">Market</th>
                      <th className="pb-2 pr-3">Side</th>
                      <th className="pb-2 pr-3">Size</th>
                      <th className="pb-2 pr-3">Avg price</th>
                      <th className="pb-2">Notional</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.positions.map((p) => (
                      <tr key={`${p.platform}:${p.marketExternalId}`} className="border-b border-white/5">
                        <td className="py-2 pr-3">{p.platform}</td>
                        <td className="py-2 pr-3 max-w-[200px] truncate">
                          <Link
                            href={`/markets/${p.platform}/${p.marketExternalId}`}
                            className="underline hover:text-white"
                          >
                            {p.marketExternalId.slice(0, 16)}…
                          </Link>
                        </td>
                        <td className={`py-2 pr-3 ${p.side === 'LONG' ? 'text-emerald-400' : 'text-red-400'}`}>{p.side}</td>
                        <td className="py-2 pr-3">{p.netSize.toFixed(2)}</td>
                        <td className="py-2 pr-3">{(p.avgPrice * 100).toFixed(2)}¢</td>
                        <td className="py-2">${p.notionalUsd.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Recent fills */}
          <div className="card">
            <div className="font-semibold mb-4">Recent paper fills</div>
            {data.recentFills.length === 0 ? (
              <p className="text-sm text-zinc-500">No fills recorded yet.</p>
            ) : (
              <div className="space-y-1 font-mono text-xs max-h-80 overflow-y-auto">
                {data.recentFills.map((f) => (
                  <div key={f.id} className="flex flex-wrap gap-3 py-1 border-b border-white/5 text-zinc-300">
                    <span className="text-zinc-500">{new Date(f.filledAt).toLocaleString()}</span>
                    <span className={f.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}>{f.side}</span>
                    <span>{f.size.toFixed(1)} @ {(f.price * 100).toFixed(2)}¢</span>
                    <span className="text-zinc-500">{f.platform}</span>
                    {f.strategyName && <span className="text-violet-400">{f.strategyName}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
