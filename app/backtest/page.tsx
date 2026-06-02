'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { runBacktest, type BacktestResult } from '@/lib/backtest/engine';
import { availableStrategies } from '@/lib/strategies';
import type { StrategyProposal } from '@/lib/research/grok-agent';
import type { StrategyVariant } from '@/lib/strategies/variants';
import { getErrorMessage } from '@/lib/error-message';

interface ReplayResult {
  totalPnl?: number;
  trades?: Record<string, unknown>[];
  message?: string;
  comparisons?: Record<string, unknown>[];
}

interface Proposal {
  description: string;
  [key: string]: unknown;
}

interface Variant {
  id: string;
  name: string;
}

export default function BacktestPage() {
  const [strategyType, setStrategyType] = useState('spread-scalper');
  const [pricesInput, setPricesInput] = useState('0.45,0.46,0.44,0.43,0.47,0.51,0.49,0.52');
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [replayResult, setReplayResult] = useState<ReplayResult | null>(null);
  const [loadingReplay, setLoadingReplay] = useState(false);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [applying, setApplying] = useState<string | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [selectedVariantId, setSelectedVariantId] = useState<string>('');
  const [useRealisticFills, setUseRealisticFills] = useState(true);

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
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Backtest failed';
      alert(message);
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
          marketExternalId: '0x...', // user would fill real token id in real use
          strategyType,
          hours: 24,
          variantId: selectedVariantId || undefined,
          realisticPassiveFills: useRealisticFills,
        }),
      });
      const data = await res.json();
      setReplayResult(data);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'unknown';
      alert('Replay failed: ' + message);
    } finally {
      setLoadingReplay(false);
    }
  }

  async function loadProposals() {
    try {
      const res = await fetch('/api/research/proposals');
      const data = await res.json();
      setProposals(data.proposals || []);
    } catch {
      console.warn('Could not load proposals');
    }
  }

  async function applyProposal(proposal: Proposal) {
    setApplying(proposal.description);
    try {
      const res = await fetch('/api/research/apply-proposal', {
        method: 'POST',
        body: JSON.stringify({ proposal }),
      });
      const data = await res.json();
      alert(data.message || 'Variant created! Check the variants system or replay with the new config.');
      await loadProposals();
      await loadVariants();

      if (data.comparisons && data.comparisons.length > 0) {
        alert(`Variant created!\n\nAuto-comparison results:\n` + 
          (data.comparisons as Record<string, unknown>[] || []).map((c: Record<string, unknown>) => 
            `${(c.market as Record<string, unknown>)?.marketExternalId || 'unknown'}: Base PnL ${((c.base as Record<string, unknown>)?.totalPnl as unknown as number | undefined)?.toFixed(2) || 0} | Variant PnL ${((c.variant as Record<string, unknown>)?.totalPnl as unknown as number | undefined)?.toFixed(2) || 0} | Delta ${((c.deltaPnl as Record<string, unknown>) as unknown as number | undefined)?.toFixed(2) || 0}`
          ).join('\n')
        );
      }
    } catch {
      alert('Failed to apply');
    } finally {
      setApplying(null);
    }
  }

  async function loadVariants() {
    try {
      const res = await fetch('/api/strategies/variants');
      const data = await res.json();
      setVariants(data.variants || []);
    } catch {}
  }

   
  useEffect(() => {
    loadProposals();
    loadVariants();
  }, []);

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
          <div className="mb-3">
            <div className="text-xs mb-1 text-zinc-400">Compare against variant (optional)</div>
            <select 
              value={selectedVariantId} 
              onChange={e => setSelectedVariantId(e.target.value)}
              className="w-full bg-zinc-950 border border-white/10 rounded px-3 py-2 text-sm"
            >
              <option value="">Base strategy only</option>
              {variants.length > 0 ? variants.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              )) : (
                <option disabled>No variants applied yet (apply from proposals above)</option>
              )}
            </select>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <input 
              type="checkbox" 
              id="realisticFills" 
              checked={useRealisticFills}
              onChange={e => setUseRealisticFills(e.target.checked)}
              className="accent-emerald-500"
            />
            <label htmlFor="realisticFills" className="text-xs text-zinc-400">
              Use realistic passive fill simulation (recommended for serious research)
            </label>
          </div>

          <button 
            onClick={runHistoricalReplay} 
            disabled={loadingReplay}
            className="w-full rounded-full bg-emerald-600 disabled:bg-zinc-700 py-2 font-medium"
          >
            {loadingReplay ? 'Replaying...' : 'Run Historical Replay (Last 24h)'}
          </button>

          <div className="text-[10px] text-zinc-500 mt-2">
            Tip: Apply a Grok proposal as a variant above, then select it here to directly compare base vs proposed on identical historical data.
          </div>
          <div className="text-xs text-zinc-500 mt-2">
            Requires the runner to have collected snapshots (it now does automatically).
          </div>
        </div>
      </div>

      {result && (
        <div className="card mt-6">
          <div className="font-medium mb-3">Synthetic Result</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div><div className="text-xs text-zinc-500">Trades</div><div className="text-2xl font-mono">{result.totalTrades ?? 0}</div></div>
            <div><div className="text-xs text-zinc-500">Win Rate</div><div className="text-2xl font-mono">{(result.totalTrades ?? 0) ? (((result.winningTrades ?? 0) / (result.totalTrades ?? 1)) * 100).toFixed(0) : 0}%</div></div>
            <div><div className="text-xs text-zinc-500">Total PnL</div><div className="text-2xl font-mono text-emerald-400">${(result.totalPnl ?? 0).toFixed(2)}</div></div>
            <div><div className="text-xs text-zinc-500">Max DD</div><div className="text-2xl font-mono text-red-400">${(result.maxDrawdown ?? 0).toFixed(2)}</div></div>
          </div>
        </div>
      )}

      {replayResult && (
        <div className="card mt-6">
          <div className="font-medium mb-4">Historical Replay Result</div>
          {replayResult.message && (
            <p className="text-sm text-zinc-400 mb-4">{replayResult.message}</p>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-xs text-zinc-500">Total PnL</div>
              <div className="text-2xl font-mono text-emerald-400">${(replayResult.totalPnl ?? 0).toFixed(2)}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Trades</div>
              <div className="text-2xl font-mono">{replayResult.trades?.length ?? 0}</div>
            </div>
          </div>
          {replayResult.comparisons && replayResult.comparisons.length > 0 && (
            <div className="mt-4 text-xs text-zinc-400 space-y-1">
              {replayResult.comparisons.map((c, i) => (
                <div key={i}>{JSON.stringify(c)}</div>
              ))}
            </div>
          )}
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
        
        <div className="mb-4 flex gap-3">
          <button onClick={loadProposals} className="text-sm underline text-emerald-400">
            Refresh Proposals
          </button>
          <a href="/api/research/proposals" target="_blank" className="text-sm underline text-emerald-400">
            View Raw (JSON)
          </a>
        </div>

        {proposals.length === 0 && (
          <div className="text-xs text-zinc-500">No proposals yet. Run some Grok analyses above to generate them.</div>
        )}

        <div className="space-y-3">
          {proposals.slice(0, 5).map((p, idx) => (
            <div key={idx} className="border border-white/10 rounded p-3 text-sm">
              <div className="font-medium">{p.description}</div>
              <div className="text-xs text-zinc-400 mt-1">
                Strategy: {p.strategyId as string} • Confidence: {((p.confidence as number) * 100).toFixed(0)}% • Type: {p.type as string}
              </div>
              <button
                onClick={() => applyProposal(p)}
                disabled={!!applying}
                className="mt-2 text-xs bg-white/10 hover:bg-white/20 px-3 py-1 rounded disabled:opacity-50"
              >
                {applying === p.description ? 'Applying...' : 'Apply as Testable Variant'}
              </button>
            </div>
          ))}
        </div>

        <div className="mt-4 text-[10px] text-zinc-500">
          Pro tip: After applying a variant, use the Historical Replay section above to test it against real data before enabling it live.
        </div>
      </div>
    </div>
  );
}
