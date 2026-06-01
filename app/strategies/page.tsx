'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Play, Square, Plus } from 'lucide-react';
import { availableStrategies } from '@/lib/strategies';

interface StrategyRow {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  paperOnly: boolean;
  config: any;
}

export default function StrategiesPage() {
  const [strategies, setStrategies] = useState<StrategyRow[]>([]);
  const [runnerStatus, setRunnerStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newStrat, setNewStrat] = useState({
    name: 'My Scalper',
    type: 'spread-scalper',
    maxSizeUsd: 150,
    targetProfitPct: 2.8,
    cooldownSeconds: 180,
    minSpreadPct: 1.9,
  });

  async function load() {
    setLoading(true);
    const [stratRes, runnerRes] = await Promise.all([
      fetch('/api/strategies'),
      fetch('/api/runner'),
    ]);
    if (stratRes.ok) setStrategies(await stratRes.json());
    if (runnerRes.ok) setRunnerStatus(await runnerRes.json());
    setLoading(false);
  }

  async function toggleStrategy(id: string, isActive: boolean) {
    await fetch(`/api/strategies/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !isActive }),
    });
    load();
  }

  async function createStrategy() {
    const config = {
      maxSizeUsd: newStrat.maxSizeUsd,
      targetProfitPct: newStrat.targetProfitPct,
      cooldownSeconds: newStrat.cooldownSeconds,
      minSpreadPct: newStrat.minSpreadPct,
    };

    await fetch('/api/strategies', {
      method: 'POST',
      body: JSON.stringify({
        name: newStrat.name,
        type: newStrat.type,
        config,
        paperOnly: true,
      }),
    });

    setShowForm(false);
    load();
  }

  async function controlRunner(action: 'start' | 'stop') {
    await fetch('/api/runner', {
      method: 'POST',
      body: JSON.stringify({ action }),
    });
    load();
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white mb-6">
        <ArrowLeft className="h-4 w-4" /> Back to Dashboard
      </Link>

      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight">Strategies</h1>
          <p className="text-zinc-400">Paper-first automated sniping rules</p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => controlRunner(runnerStatus?.running ? 'stop' : 'start')}
            className={`flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium border transition ${runnerStatus?.running ? 'border-red-500 text-red-400' : 'border-emerald-500 text-emerald-400'}`}
          >
            {runnerStatus?.running ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {runnerStatus?.running ? 'Stop 24/7 Runner' : 'Start 24/7 Paper Runner'}
          </button>
          <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 rounded-full bg-white text-black px-5 py-2 text-sm font-medium">
            <Plus className="h-4 w-4" /> New Strategy
          </button>
          <Link href="/real" className="flex items-center gap-2 rounded-full border border-red-900/60 text-red-400 px-5 py-2 text-sm font-medium hover:bg-red-950/40">
            Real Execution (Danger)
          </Link>
        </div>
      </div>

      {runnerStatus && (
        <div className="mb-8 text-sm bg-zinc-900 border border-white/10 rounded-xl p-4">
          <span className="font-medium">Runner Status:</span>{' '}
          <span className={runnerStatus.running ? 'text-emerald-400' : 'text-zinc-500'}>
            {runnerStatus.running ? 'RUNNING' : 'STOPPED'}
          </span>
          {' '}• Last run: {runnerStatus.lastRun ? new Date(runnerStatus.lastRun).toLocaleTimeString() : 'never'}
          {' '}• Signals: {runnerStatus.signalsGenerated} • Paper fills: {runnerStatus.fillsExecuted}
        </div>
      )}

      {/* Live Performance Attribution */}
      <div className="mb-6">
        <a href="/api/research/performance" target="_blank" className="text-xs underline text-zinc-400 hover:text-white">
          View 7-day Strategy Performance Attribution →
        </a>
      </div>

      {/* Real Execution Warning Banner */}
      {process.env.NEXT_PUBLIC_REAL_EXECUTION_ENABLED === 'true' || true /* we'll improve this */ ? (
        <div className="mb-8 rounded-xl border border-red-900/70 bg-red-950/60 p-4 text-sm">
          <div className="font-semibold text-red-400 mb-1">⚠️ REAL EXECUTION MODE</div>
          <div className="text-red-300/90">
            Real money trading is available only when <code>SNIPER_ENABLE_REAL_EXECUTION=true</code> is set in your environment.
            Even then, every real order goes through strict risk checks. Paper mode is still strongly recommended.
          </div>
        </div>
      ) : null}

      {showForm && (
        <div className="card mb-8">
          <div className="font-medium mb-4">Create New Strategy</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input className="bg-zinc-950 border border-white/10 rounded px-3 py-2" placeholder="Name" value={newStrat.name} onChange={e => setNewStrat({ ...newStrat, name: e.target.value })} />
            <select className="bg-zinc-950 border border-white/10 rounded px-3 py-2" value={newStrat.type} onChange={e => setNewStrat({ ...newStrat, type: e.target.value })}>
              {availableStrategies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input type="number" className="bg-zinc-950 border border-white/10 rounded px-3 py-2" placeholder="Max Size USD" value={newStrat.maxSizeUsd} onChange={e => setNewStrat({ ...newStrat, maxSizeUsd: Number(e.target.value) })} />
            <input type="number" step="0.1" className="bg-zinc-950 border border-white/10 rounded px-3 py-2" placeholder="Target Profit %" value={newStrat.targetProfitPct} onChange={e => setNewStrat({ ...newStrat, targetProfitPct: Number(e.target.value) })} />
            <input type="number" className="bg-zinc-950 border border-white/10 rounded px-3 py-2" placeholder="Cooldown (seconds)" value={newStrat.cooldownSeconds} onChange={e => setNewStrat({ ...newStrat, cooldownSeconds: Number(e.target.value) })} />
            {newStrat.type === 'spread-scalper' && (
              <input type="number" step="0.1" className="bg-zinc-950 border border-white/10 rounded px-3 py-2" placeholder="Min Spread %" value={newStrat.minSpreadPct} onChange={e => setNewStrat({ ...newStrat, minSpreadPct: Number(e.target.value) })} />
            )}
          </div>
          <button onClick={createStrategy} className="mt-4 w-full rounded-full bg-white text-black py-2 font-medium">Create &amp; Save Strategy</button>
        </div>
      )}

      <div className="card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left">
              <th className="py-3 px-4">Name</th>
              <th className="py-3 px-4">Type</th>
              <th className="py-3 px-4">Max Size</th>
              <th className="py-3 px-4">Target %</th>
              <th className="py-3 px-4">Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {strategies.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-500">No strategies yet. Create one above.</td></tr>}
            {strategies.map(s => (
              <tr key={s.id} className="border-b border-white/10 last:border-0">
                <td className="py-3 px-4 font-medium">{s.name}</td>
                <td className="py-3 px-4 text-zinc-400">{s.type}</td>
                <td className="py-3 px-4 font-mono">${s.config?.maxSizeUsd ?? 100}</td>
                <td className="py-3 px-4 font-mono">{s.config?.targetProfitPct ?? 2.5}%</td>
                <td className="py-3 px-4">
                  <span className={`px-2 py-0.5 rounded text-xs ${s.isActive ? 'bg-emerald-950 text-emerald-400' : 'bg-zinc-800'}`}>
                    {s.isActive ? 'ACTIVE' : 'PAUSED'}
                  </span>
                </td>
                <td className="py-3 px-4 text-right">
                  <button onClick={() => toggleStrategy(s.id, s.isActive)} className="text-xs underline">
                    {s.isActive ? 'Pause' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 text-xs text-zinc-500">
        The runner (when started) will automatically evaluate active strategies every ~12 seconds against live market data and execute paper trades.
      </div>
    </div>
  );
}
