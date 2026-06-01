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
  const [replayResult, setReplayResult] = useState<any>(null);
  const [loadingReplay, setLoadingReplay] = useState(false);

  function runSynthetic() {
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

  async function runHistoricalReplay() {
    setLoadingReplay(true);
    setReplayResult(null);

    try {
      const res = await fetch('/api/research/replay', {
        method: 'POST',
        body: JSON.stringify({
          platform: 'polymarket',
          marketExternalId: '0x...', // user would fill real token id
          strategyType,
          hours: 24,
        }),
      });
      const data = await res.json();
      setReplayResult(data);
    } catch (e: any) {
      alert('Replay failed: ' + e.message);
    } finally {
      setLoadingReplay(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <Link href="/strategies" className="flex items-center gap-2 text-sm text-zinc-400 mb-6">
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>

      <h1 className="text-3xl font-semibold mb-2">Research &amp; Backtesting Lab</h1>
      <p className="text-zinc-400 mb-8">Synthetic tests + historical replay against real order book data</p>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Synthetic Backtest */}
        <div className="card">
          <div className="font-medium mb-4">Synthetic Price Series</div>
          <div className="grid grid-cols-1 gap-4 mb-4">
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
          <button onClick={runSynthetic} className="w-full rounded-full bg-white text-black py-2 font-medium">Run Synthetic Backtest</button>
        </div>

        {/* Historical Replay (the powerful one) */}
        <div className="card">
          <div className="font-medium mb-4">Historical Order Book Replay</div>
          <p className="text-sm text-zinc-400 mb-4">
            Replay strategies against real snapshots collected by the live runner. 
            This is how you actually discover and validate edges.
          </p>
          <button 
            onClick={runHistoricalReplay} 
            disabled={loadingReplay}
            className="w-full rounded-full bg-emerald-600 disabled:bg-zinc-700 py-2 font-medium"
          >
            {loadingReplay ? 'Replaying...' : 'Run Historical Replay (Last 24h)'}
          </button>
          <div className="text-xs text-zinc-500 mt-2">
            Requires the runner to have collected snapshots (it now does automatically).
          </div>
        </div>
      </div>

      {result && (
        <div className="card mt-6">
          <div className="font-medium mb-3">Synthetic Result</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div><div className="text-xs text-zinc-500">Trades</div><div className="text-2xl font-mono">{result.totalTrades}</div></div>
            <div><div className="text-xs text-zinc-500">Win Rate</div><div className="text-2xl font-mono">{result.totalTrades ? ((result.winningTrades / result.totalTrades) * 100).toFixed(0) : 0}%</div></div>
            <div><div className="text-xs text-zinc-500">Total PnL</div><div className="text-2xl font-mono text-emerald-400">${result.totalPnl.toFixed(2)}</div></div>
            <div><div className="text-xs text-zinc-500">Max DD</div><div className="text-2xl font-mono text-red-400">${result.maxDrawdown.toFixed(2)}</div></div>
          </div>
        </div>
      )}

      {replayResult && (
        <div className="card mt-6">
          <div className="font-medium mb-3">Historical Replay Result</div>
          <pre className="text-xs bg-black p-4 rounded overflow-auto">
            {JSON.stringify(replayResult, null, 2)}
          </pre>
        </div>
      )}

      <div className="card mt-8">
        <div className="font-medium mb-4">Grok Research Agent</div>
        <p className="text-sm text-zinc-400 mb-4">
          Use Grok to analyze your strategies and data. This is how you turn raw snapshots and attribution into real edge improvements.
        </p>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={async () => {
              const res = await fetch('/api/research/agent', {
                method: 'POST',
                body: JSON.stringify({
                  type: 'strategy_analysis',
                  strategyId: strategyType,
                  lookbackHours: 48,
                }),
              });
              const data = await res.json();
              alert(data.analysis || data.error);
            }}
            className="rounded-full border border-white/20 px-4 py-2 text-sm hover:bg-white/5"
          >
            Analyze Current Strategy Performance
          </button>

          <button
            onClick={async () => {
              const res = await fetch('/api/research/agent', {
                method: 'POST',
                body: JSON.stringify({ type: 'feature_ideas', lookbackHours: 24 }),
              });
              const data = await res.json();
              alert(data.analysis || data.error);
            }}
            className="rounded-full border border-white/20 px-4 py-2 text-sm hover:bg-white/5"
          >
            Suggest New Features from Recent Data
          </button>

          <button
            onClick={async () => {
              const res = await fetch('/api/research/agent', {
                method: 'POST',
                body: JSON.stringify({ type: 'regime_detection', lookbackHours: 36 }),
              });
              const data = await res.json();
              alert(data.analysis || data.error);
            }}
            className="rounded-full border border-white/20 px-4 py-2 text-sm hover:bg-white/5"
          >
            Detect Market Regimes
          </button>
        </div>
        <div className="text-[10px] text-zinc-500 mt-3">
          Requires XAI_API_KEY. Analyses are logged and can be used to improve strategies over time.
        </div>
      </div>

      {/* Proposals Review */}
      <div className="card mt-6">
        <div className="font-medium mb-3">Recent Grok Strategy Proposals</div>
        <a href="/api/research/proposals" target="_blank" className="text-sm underline text-emerald-400">
          View Latest Proposals →
        </a>
        <div className="text-xs text-zinc-500 mt-2">
          Proposals generated by the agent are stored here for review before manual or automated testing.
        </div>
      </div>
    </div>
  );
}
