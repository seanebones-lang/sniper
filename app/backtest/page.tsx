'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { runBacktest } from '@/lib/backtest/engine';
import { availableStrategies } from '@/lib/strategies';

export default function BacktestPage() {
  const [strategyType, setStrategyType] = useState('spread-scalper');
  const [pricesInput, setPricesInput] = useState('0.45,0.46,0.44,0.43,0.47,0.51,0.49,0.52');
  const [result, setResult] = useState<any>(null);

  function run() {
    const prices = pricesInput.split(',').map(p => parseFloat(p.trim()) / 100);
    const config = {
      maxSizeUsd: 100,
      targetProfitPct: 2.5,
      cooldownSeconds: 300,
      minSpreadPct: 1.8,
      entryThreshold: 0.46,
    };

    try {
      const res = runBacktest({ strategyType, config, prices });
      setResult(res);
    } catch (e: any) {
      alert(e.message);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <Link href="/strategies" className="flex items-center gap-2 text-sm text-zinc-400 mb-6">
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>

      <h1 className="text-3xl font-semibold mb-6">Basic Backtester</h1>

      <div className="card mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="text-xs mb-1">Strategy</div>
            <select value={strategyType} onChange={e => setStrategyType(e.target.value)} className="w-full bg-zinc-950 border border-white/10 rounded px-3 py-2">
              {availableStrategies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <div className="text-xs mb-1">Price Series (cents, comma separated)</div>
            <input value={pricesInput} onChange={e => setPricesInput(e.target.value)} className="w-full font-mono bg-zinc-950 border border-white/10 rounded px-3 py-2" />
          </div>
        </div>
        <button onClick={run} className="mt-4 w-full rounded-full bg-white text-black py-2 font-medium">Run Backtest</button>
      </div>

      {result && (
        <div className="card">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div><div className="text-xs text-zinc-500">Trades</div><div className="text-2xl font-mono">{result.totalTrades}</div></div>
            <div><div className="text-xs text-zinc-500">Win Rate</div><div className="text-2xl font-mono">{result.totalTrades ? ((result.winningTrades / result.totalTrades) * 100).toFixed(0) : 0}%</div></div>
            <div><div className="text-xs text-zinc-500">Total PnL</div><div className="text-2xl font-mono text-emerald-400">${result.totalPnl.toFixed(2)}</div></div>
            <div><div className="text-xs text-zinc-500">Max DD</div><div className="text-2xl font-mono text-red-400">${result.maxDrawdown.toFixed(2)}</div></div>
          </div>
        </div>
      )}

      <div className="mt-6 text-xs text-zinc-500">
        Very basic backtester for quick iteration. Real version should use historical order book snapshots.
      </div>
    </div>
  );
}
