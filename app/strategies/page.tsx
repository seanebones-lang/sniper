'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Play, Square, Plus, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { availableStrategies } from '@/lib/strategies';
import {
  TRADING_STYLE_OPTIONS,
  TRADING_GOAL_OPTIONS,
} from '@/lib/strategies/run-profile';

interface StrategyRow {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  paperOnly: boolean;
  config: Record<string, unknown>;
}

const STRATEGY_DESCRIPTIONS: Record<string, { summary: string; when: string }> = {
  'spread-scalper': {
    summary: 'Buys when the bid/ask spread is wide enough — profits from the gap between buyers and sellers.',
    when: 'Best on liquid markets where spreads occasionally widen.',
  },
  threshold: {
    summary: 'Buys when price drops below your entry threshold; sells when it hits your profit target.',
    when: 'Best when you believe a market is temporarily cheap.',
  },
  'orderbook-imbalance': {
    summary: 'Trades when one side of the order book has much more size than the other.',
    when: 'Best when you see heavy buying or selling pressure that price hasn\'t reflected yet.',
  },
  'resolution-proximity': {
    summary: 'Looks for strong directional pressure near the end of short-term markets (5m–1h).',
    when: 'Best on short-duration crypto or event markets close to resolution.',
  },
  'live-quick-flip': {
    summary: 'Buys ~$1 on markets resolving within 3 hours and sells at 2.5× (~$2.50).',
    when: 'Best on live tennis, in-play sports, and other markets with exchange end time under 3h.',
  },
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-zinc-200 mb-1">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-zinc-500 leading-relaxed">{hint}</p>}
    </div>
  );
}

const inputClass =
  'w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-white/30';

export default function StrategiesPage() {
  const [strategies, setStrategies] = useState<StrategyRow[]>([]);
  const [runnerStatus, setRunnerStatus] = useState<{
    running: boolean;
    lastRun: string | null;
    signalsGenerated: number;
    fillsExecuted: number;
    dbPaperFillsTotal?: number;
    dbPaperFillsToday?: number;
    activeStrategies?: number;
    executionMode?: 'paper' | 'live' | 'mixed';
    realExecutionEnabled?: boolean;
    lastCycle?: {
      marketPoolSize: number;
      eligibleQuickFlipMarkets: number;
      marketsEvaluated: number;
      signalsThisCycle?: number;
      fillsThisCycle?: number;
      skipReason: string | null;
      activeProfiles: Array<{
        name: string;
        tradingStyle: string;
        tradingGoal: string;
      }>;
    } | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newStrat, setNewStrat] = useState({
    name: 'Live Quick Flip',
    type: 'live-quick-flip',
    maxSizeUsd: 1,
    targetProfitPct: 150,
    targetProfitMultiple: 2.5,
    targetExitValueUsd: 2.5,
    cooldownSeconds: 15,
    minSpreadPct: 1.9,
    entryThreshold: 0.48,
    tradingStyle: 'aggressive' as 'aggressive' | 'balanced' | 'conservative',
    tradingGoal: 'quick-flip' as 'quick-flip' | 'spread-capture' | 'dip-buy' | 'swing',
    stopLossPct: 12,
    maxHoldSeconds: 90,
  });

  const selectedTypeInfo = STRATEGY_DESCRIPTIONS[newStrat.type];

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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !isActive }),
    });
    load();
  }

  async function toggleExecutionMode(id: string, name: string, paperOnly: boolean) {
    // Going paper -> live places REAL orders with real money. Require explicit confirmation.
    if (paperOnly) {
      const ok = confirm(
        `Switch "${name}" to LIVE (real-money) execution?\n\n` +
          'Real orders will be placed when this strategy is active AND ' +
          'SNIPER_ENABLE_REAL_EXECUTION=true is set server-side (plus valid platform keys).\n\n' +
          'Use a dedicated low-balance wallet. Continue?',
      );
      if (!ok) return;
    }
    const res = await fetch(`/api/strategies/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paperOnly: !paperOnly }),
    });
    if (res.ok) {
      toast.success(paperOnly ? `${name} set to LIVE execution` : `${name} set to PAPER execution`);
    } else {
      toast.error('Failed to change execution mode');
    }
    load();
  }

  async function createStrategy() {
    const config: Record<string, string | number | boolean> = {
      maxSizeUsd: newStrat.maxSizeUsd,
      targetProfitPct: newStrat.targetProfitPct,
      cooldownSeconds: newStrat.cooldownSeconds,
      tradingStyle: newStrat.tradingStyle,
      tradingGoal: newStrat.tradingGoal,
      stopLossPct: newStrat.stopLossPct,
      maxHoldSeconds: newStrat.maxHoldSeconds,
    };

    if (newStrat.tradingGoal === 'quick-flip' || newStrat.type === 'live-quick-flip') {
      config.targetProfitMultiple = newStrat.targetProfitMultiple;
      config.targetExitValueUsd = newStrat.targetExitValueUsd;
      config.liveMarketsOnly = true;
    }

    if (newStrat.type === 'spread-scalper') {
      config.minSpreadPct = newStrat.minSpreadPct;
    }
    if (newStrat.type === 'threshold') {
      config.entryThreshold = newStrat.entryThreshold;
    }

    await fetch('/api/strategies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

  async function startNewRun() {
    if (!confirm(
      'Start a new paper run? UI counters and open positions reset — database history is kept.',
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
    toast.success('New paper run started');
    if (json.portfolio?.runner) {
      setRunnerStatus((prev) => prev ? { ...prev, ...json.portfolio.runner } : prev);
    }
    load();
  }

  async function controlRunner(action: 'start' | 'stop') {
    const res = await fetch('/api/runner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(json.error || 'Failed to control runner');
      return;
    }
    setRunnerStatus({
      running: json.running ?? action === 'start',
      lastRun: json.lastRun ?? null,
      signalsGenerated: json.signalsGenerated ?? 0,
      fillsExecuted: json.fillsExecuted ?? 0,
      dbPaperFillsTotal: json.dbPaperFillsTotal,
      dbPaperFillsToday: json.dbPaperFillsToday,
      activeStrategies: json.activeStrategies,
      lastCycle: json.lastCycle ?? null,
    });
    load();
  }

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      const [stratRes, runnerRes] = await Promise.all([
        fetch('/api/strategies'),
        fetch('/api/runner'),
      ]);
      if (cancelled) return;
      if (stratRes.ok) setStrategies(await stratRes.json());
      if (runnerRes.ok) setRunnerStatus(await runnerRes.json());
      setLoading(false);
    }

    void fetchData();
    const interval = setInterval(() => { void fetchData(); }, 8000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white mb-6">
        <ArrowLeft className="h-4 w-4" /> Back to Dashboard
      </Link>

      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4 mb-8">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight">Strategies</h1>
          <p className="text-zinc-400 mt-1">Automated trading rules — paper mode by default</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => void startNewRun()}
            className="flex items-center gap-2 rounded-full border border-amber-500/50 text-amber-300 px-4 py-2 text-sm hover:bg-amber-500/10"
            title="Reset UI for a fresh run without deleting database history"
          >
            <RotateCcw className="h-4 w-4" /> New Run
          </button>
          <button
            onClick={() => controlRunner(runnerStatus?.running ? 'stop' : 'start')}
            className={`flex items-center gap-2 rounded-full px-5 py-2 text-sm font-medium border transition ${runnerStatus?.running ? 'border-red-500 text-red-400' : 'border-emerald-500 text-emerald-400'}`}
          >
            {runnerStatus?.running ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {runnerStatus?.running
              ? 'Stop 24/7 Runner'
              : runnerStatus?.executionMode === 'live'
                ? 'Start 24/7 Live Runner'
                : 'Start 24/7 Runner'}
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 rounded-full bg-white text-black px-5 py-2 text-sm font-medium"
          >
            <Plus className="h-4 w-4" /> New Strategy
          </button>
        </div>
      </div>

      {/* How it works */}
      <div className="card mb-8 text-sm">
        <div className="font-medium mb-2">How strategies work</div>
        <ol className="text-zinc-400 space-y-1 list-decimal list-inside">
          <li><strong className="text-zinc-300">Create</strong> a strategy below and pick a rule type</li>
          <li><strong className="text-zinc-300">Activate</strong> it in the table (starts paused)</li>
          <li><strong className="text-zinc-300">Start the runner</strong> — scans markets every few seconds; fills are <strong className="text-zinc-300">paper</strong> or <strong className="text-red-400">live</strong> per strategy Mode</li>
        </ol>
      </div>

      {runnerStatus && (
        <div className="mb-8 text-sm bg-zinc-900 border border-white/10 rounded-xl p-4">
          <span className="font-medium">Runner:</span>{' '}
          <span className={runnerStatus.running ? 'text-emerald-400' : 'text-zinc-500'}>
            {runnerStatus.running ? 'RUNNING' : 'STOPPED'}
          </span>
          {runnerStatus.executionMode === 'live' && (
            <span className="ml-2 text-red-400 font-medium">· LIVE Polymarket</span>
          )}
          {runnerStatus.executionMode === 'mixed' && (
            <span className="ml-2 text-amber-400">· mixed paper + live</span>
          )}
          {runnerStatus.running && runnerStatus.executionMode === 'paper' && (
            <span className="ml-2 text-zinc-500">· paper only</span>
          )}
          {' '}· Last run: {runnerStatus.lastRun ? new Date(runnerStatus.lastRun).toLocaleTimeString() : 'never'}
          {' '}· Session signals/fills: {runnerStatus.signalsGenerated} / {runnerStatus.fillsExecuted}
          {' '}· DB fills (today): {runnerStatus.dbPaperFillsToday ?? '—'}
          {runnerStatus.lastCycle && runnerStatus.running && (
            <p className="mt-2 text-zinc-400">
              Market pool: {runnerStatus.lastCycle.marketPoolSize}
              {' '}· eligible ≤3h: {runnerStatus.lastCycle.eligibleQuickFlipMarkets}
              {' '}· evaluating: {runnerStatus.lastCycle.marketsEvaluated}
              {runnerStatus.lastCycle.activeProfiles.length > 0 && (
                <> · style: {runnerStatus.lastCycle.activeProfiles.map((p) =>
                  `${p.name} (${p.tradingStyle}/${p.tradingGoal})`).join(', ')}</>
              )}
              {runnerStatus.lastCycle.signalsThisCycle != null && (
                <span className="block mt-1 text-zinc-500">
                  Last cycle: {runnerStatus.lastCycle.signalsThisCycle} signals, {runnerStatus.lastCycle.fillsThisCycle ?? 0} fills
                  {runnerStatus.executionMode === 'live' && runnerStatus.lastCycle.signalsThisCycle === 0
                    ? ' (live-armed — waiting for a rule to fire)'
                    : ''}
                </span>
              )}
              {runnerStatus.lastCycle.skipReason && (
                <span className="block mt-1 text-amber-300">{runnerStatus.lastCycle.skipReason}</span>
              )}
            </p>
          )}
          {!runnerStatus.running && strategies.some((s) => s.isActive) && (
            <p className="mt-2 text-amber-300">
              Active strategies won&apos;t trade until you start the runner.
            </p>
          )}
        </div>
      )}

      <div className="mb-6 flex gap-4 text-xs">
        <Link href="/paper" className="underline text-emerald-400 hover:text-white font-medium">
          Paper portfolio (positions, budget, performance) →
        </Link>
        <Link href="/health" className="underline text-zinc-400 hover:text-white">Health dashboard →</Link>
      </div>

      {showForm && (
        <div className="card mb-8">
          <div className="font-medium text-lg mb-1">Create New Strategy</div>
          <p className="text-sm text-zinc-400 mb-6">
            All new strategies run in <span className="text-emerald-400">paper mode</span> only until you explicitly enable real execution in Settings / env.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Field
              label="Strategy name"
              hint="A label for you — e.g. “BTC 15m Scalper”. Does not affect logic."
            >
              <input
                className={inputClass}
                value={newStrat.name}
                onChange={e => setNewStrat({ ...newStrat, name: e.target.value })}
              />
            </Field>

            <Field
              label="Strategy type"
              hint="The rule that decides when to buy or sell."
            >
              <select
                className={inputClass}
                value={newStrat.type}
                onChange={e => setNewStrat({ ...newStrat, type: e.target.value })}
              >
                {availableStrategies.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </Field>
          </div>

          {selectedTypeInfo && (
            <div className="mt-4 rounded-lg border border-blue-900/40 bg-blue-950/20 p-4 text-sm">
              <div className="text-blue-300 font-medium mb-1">
                {availableStrategies.find(s => s.id === newStrat.type)?.name}
              </div>
              <p className="text-zinc-300">{selectedTypeInfo.summary}</p>
              <p className="text-zinc-500 mt-1 text-xs">{selectedTypeInfo.when}</p>
            </div>
          )}

          <div className="mt-6 pt-6 border-t border-white/10">
            <div className="text-sm font-medium text-zinc-300 mb-4">Paper run profile</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <Field
                label="Trading style"
                hint="How aggressively the runner executes fills and manages risk."
              >
                <select
                  className={inputClass}
                  value={newStrat.tradingStyle}
                  onChange={e => setNewStrat({
                    ...newStrat,
                    tradingStyle: e.target.value as typeof newStrat.tradingStyle,
                  })}
                >
                  {TRADING_STYLE_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-zinc-500">
                  {TRADING_STYLE_OPTIONS.find((o) => o.id === newStrat.tradingStyle)?.description}
                </p>
              </Field>

              <Field
                label="Trading goal"
                hint="What kind of edge this strategy is trying to capture."
              >
                <select
                  className={inputClass}
                  value={newStrat.tradingGoal}
                  onChange={e => setNewStrat({
                    ...newStrat,
                    tradingGoal: e.target.value as typeof newStrat.tradingGoal,
                  })}
                >
                  {TRADING_GOAL_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-zinc-500">
                  {TRADING_GOAL_OPTIONS.find((o) => o.id === newStrat.tradingGoal)?.description}
                </p>
              </Field>

              <Field
                label="Stop loss (%)"
                hint="Auto-sell if position drops this much from entry. Quick-flip default: 1.5%."
              >
                <input
                  type="number"
                  min={0.5}
                  step={0.1}
                  className={inputClass}
                  value={newStrat.stopLossPct}
                  onChange={e => setNewStrat({ ...newStrat, stopLossPct: Number(e.target.value) })}
                />
              </Field>

              <Field
                label="Max hold time (seconds)"
                hint="Force exit after this long. Quick-flip default: 90s."
              >
                <input
                  type="number"
                  min={30}
                  step={30}
                  className={inputClass}
                  value={newStrat.maxHoldSeconds}
                  onChange={e => setNewStrat({ ...newStrat, maxHoldSeconds: Number(e.target.value) })}
                />
              </Field>
            </div>
          </div>

          <div className="pt-2 border-t border-white/10">
            <div className="text-sm font-medium text-zinc-300 mb-4">Sizing &amp; timing</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Field
                label="Max size per trade (USD)"
                hint="Stake per flip. Quick-flip default: $1 in, target ~$2.50 out at 2.5×."
              >
                <input
                  type="number"
                  min={1}
                  step={1}
                  className={inputClass}
                  value={newStrat.maxSizeUsd}
                  onChange={e => setNewStrat({ ...newStrat, maxSizeUsd: Number(e.target.value) })}
                />
              </Field>

              {(newStrat.tradingGoal === 'quick-flip' || newStrat.type === 'live-quick-flip') ? (
                <>
                  <Field
                    label="Profit multiple (×)"
                    hint="Sell instantly when price hits entry × this value. Default 2.5 = double-and-a-half your stake."
                  >
                    <input
                      type="number"
                      min={1.1}
                      step={0.1}
                      className={inputClass}
                      value={newStrat.targetProfitMultiple}
                      onChange={e => setNewStrat({
                        ...newStrat,
                        targetProfitMultiple: Number(e.target.value),
                        targetExitValueUsd: newStrat.maxSizeUsd * Number(e.target.value),
                      })}
                    />
                  </Field>
                  <Field
                    label="Exit value target (USD)"
                    hint="Alternative exit: sell when position value reaches this dollar amount."
                  >
                    <input
                      type="number"
                      min={1}
                      step={0.1}
                      className={inputClass}
                      value={newStrat.targetExitValueUsd}
                      onChange={e => setNewStrat({ ...newStrat, targetExitValueUsd: Number(e.target.value) })}
                    />
                  </Field>
                </>
              ) : (
              <Field
                label="Target profit (%)"
                hint="Auto-sell when price rises this much above entry. Overridden by goal preset if left default."
              >
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  className={inputClass}
                  value={newStrat.targetProfitPct}
                  onChange={e => setNewStrat({ ...newStrat, targetProfitPct: Number(e.target.value) })}
                />
              </Field>
              )}

              <Field
                label="Cooldown between signals (seconds)"
                hint="Minimum wait before firing again on the same market. Example: 180 = 3 minutes between trades on one market."
              >
                <input
                  type="number"
                  min={30}
                  step={10}
                  className={inputClass}
                  value={newStrat.cooldownSeconds}
                  onChange={e => setNewStrat({ ...newStrat, cooldownSeconds: Number(e.target.value) })}
                />
              </Field>

              {newStrat.type === 'spread-scalper' && (
                <Field
                  label="Minimum spread to enter (%)"
                  hint="Only buy when the bid/ask spread is at least this wide. Example: 1.9 means enter when spread ≥ 1.9% of mid price."
                >
                  <input
                    type="number"
                    min={0.5}
                    step={0.1}
                    className={inputClass}
                    value={newStrat.minSpreadPct}
                    onChange={e => setNewStrat({ ...newStrat, minSpreadPct: Number(e.target.value) })}
                  />
                </Field>
              )}

              {newStrat.type === 'threshold' && (
                <Field
                  label="Buy below price (¢)"
                  hint="Buy when market price is at or below this level. Example: 48 = buy when price ≤ 48¢."
                >
                  <input
                    type="number"
                    min={1}
                    max={99}
                    step={0.5}
                    className={inputClass}
                    value={newStrat.entryThreshold * 100}
                    onChange={e => setNewStrat({ ...newStrat, entryThreshold: Number(e.target.value) / 100 })}
                  />
                </Field>
              )}
            </div>
          </div>

          <button
            onClick={createStrategy}
            className="mt-6 w-full rounded-full bg-white text-black py-2.5 font-medium hover:bg-zinc-200"
          >
            Create &amp; Save (starts paused)
          </button>
        </div>
      )}

      <div className="card">
        <div className="px-4 py-3 border-b border-white/10 text-sm font-medium">Your strategies</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-zinc-500">
              <th className="py-3 px-4 font-normal">Name</th>
              <th className="py-3 px-4 font-normal">Type</th>
              <th className="py-3 px-4 font-normal">Goal</th>
              <th className="py-3 px-4 font-normal">Style</th>
              <th className="py-3 px-4 font-normal">Max / trade</th>
              <th className="py-3 px-4 font-normal">Key setting</th>
              <th className="py-3 px-4 font-normal">Status</th>
              <th className="py-3 px-4 font-normal">Mode</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && strategies.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-zinc-500">Loading…</td></tr>
            )}
            {!loading && strategies.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-zinc-500">No strategies yet. Click “New Strategy” above.</td></tr>
            )}
            {strategies.map(s => {
              const cfg = (s.config ?? {}) as Record<string, string | number | undefined>;
              let keySetting = `Target ${cfg.targetProfitPct ?? 2.5}%`;
              if (s.type === 'spread-scalper') keySetting = `Min spread ${cfg.minSpreadPct ?? 1.8}%`;
              if (s.type === 'threshold') keySetting = `Buy ≤ ${((Number(cfg.entryThreshold) || 0.48) * 100).toFixed(0)}¢`;
              const goalLabel = String(cfg.tradingGoal ?? 'spread-capture').replace(/-/g, ' ');
              const styleLabel = String(cfg.tradingStyle ?? 'balanced');

              return (
                <tr key={s.id} className="border-b border-white/10 last:border-0">
                  <td className="py-3 px-4 font-medium">{s.name}</td>
                  <td className="py-3 px-4 text-zinc-400">{s.type}</td>
                  <td className="py-3 px-4 text-zinc-400 capitalize text-xs">{goalLabel}</td>
                  <td className="py-3 px-4 text-zinc-400 capitalize text-xs">{styleLabel}</td>
                  <td className="py-3 px-4 font-mono">${cfg.maxSizeUsd ?? 100}</td>
                  <td className="py-3 px-4 text-zinc-400 text-xs">{keySetting}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-0.5 rounded text-xs ${s.isActive ? 'bg-emerald-950 text-emerald-400' : 'bg-zinc-800 text-zinc-400'}`}>
                      {s.isActive ? 'ACTIVE' : 'PAUSED'}
                    </span>
                    <span
                      className={`ml-2 text-[10px] ${s.paperOnly ? 'text-zinc-600' : 'text-amber-400 font-semibold'}`}
                    >
                      {s.paperOnly ? 'paper' : 'LIVE'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <button
                      onClick={() => toggleExecutionMode(s.id, s.name, s.paperOnly)}
                      className="text-xs underline hover:text-white mr-3 text-zinc-400"
                    >
                      {s.paperOnly ? 'Go live' : 'Go paper'}
                    </button>
                    <button onClick={() => toggleStrategy(s.id, s.isActive)} className="text-xs underline hover:text-white">
                      {s.isActive ? 'Pause' : 'Activate'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-6 text-xs text-zinc-500 leading-relaxed">
        The runner scans top markets every ~12 seconds. Only <strong className="text-zinc-400">ACTIVE</strong> strategies participate.
        Trades are simulated (paper) unless real execution is explicitly enabled server-side.
      </div>
    </div>
  );
}
