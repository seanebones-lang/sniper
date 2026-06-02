'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LivePaperPortfolio } from '@/components/live-paper-portfolio';
import {
  ArrowLeft,
  TrendingUp,
  Shield,
  Clock,
  Activity,
  BarChart3,
  Sparkles,
  Zap,
  Wallet,
} from 'lucide-react';

interface HealthData {
  timestamp: string;
  risk?: { mode: string; reason: string; riskMultiplier: number };
  execution?: { systemHealthScore: number; unhealthyMarkets: unknown[]; averageSlippage: number };
  summary?: { totalActiveStrategies: number; totalVariants: number; marketsWithPoorExecution: number };
  recentPerformance?: { totalPaperFills: number; totalSignals: number };
}

interface RunnerData {
  running: boolean;
  lastRun: string | null;
  dbPaperFillsToday?: number;
}

export default function Dashboard() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [runner, setRunner] = useState<RunnerData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [healthRes, runnerRes] = await Promise.all([
          fetch('/api/health'),
          fetch('/api/runner'),
        ]);
        if (healthRes.ok) setHealth(await healthRes.json());
        if (runnerRes.ok) setRunner(await runnerRes.json());
      } finally {
        setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  const riskMode = health?.risk?.mode ?? 'NORMAL';

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white mb-8">
        <ArrowLeft className="h-4 w-4" /> Back to home
      </Link>

      <div className="flex items-center justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Shield className="h-8 w-8 text-emerald-400" />
            <h1 className="text-4xl font-semibold tracking-tight">Dashboard</h1>
          </div>
          <p className="text-zinc-400">Paper mode · live portfolio &amp; system status</p>
        </div>
        <Link
          href="/health"
          className="text-sm rounded-full border border-white/20 px-4 py-2 hover:bg-white/5 transition"
        >
          Full health view →
        </Link>
      </div>

      {/* Runner strip */}
      {runner && (
        <div className={`card mb-6 text-sm flex flex-wrap items-center gap-x-4 gap-y-1 ${
          !runner.running ? 'border-amber-500/30' : 'border-emerald-500/20'
        }`}>
          <span className="text-zinc-500">24/7 paper runner</span>
          <span className={runner.running ? 'text-emerald-400 font-medium' : 'text-amber-400 font-medium'}>
            {runner.running ? 'RUNNING' : 'STOPPED'}
          </span>
          {runner.lastRun && (
            <span className="text-zinc-500">Last cycle {new Date(runner.lastRun).toLocaleTimeString()}</span>
          )}
          {!runner.running && (
            <Link href="/paper" className="text-emerald-400 underline hover:text-white">
              Start runner on Paper Portfolio →
            </Link>
          )}
        </div>
      )}

      {/* Live paper portfolio — polls every 3s */}
      <div className="mb-8">
        <LivePaperPortfolio pollMs={3000} />
      </div>

      {/* Live status strip */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="card">
          <div className="text-xs text-zinc-500 mb-1">Risk Mode</div>
          <div className={`text-lg font-semibold ${
            riskMode === 'EMERGENCY' ? 'text-red-400' :
            riskMode === 'DEFENSIVE' ? 'text-amber-400' : 'text-emerald-400'
          }`}>
            {loading ? '…' : riskMode}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-zinc-500 mb-1">Active Strategies</div>
          <div className="text-lg font-semibold font-mono">
            {loading ? '…' : (health?.summary?.totalActiveStrategies ?? 0)}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-zinc-500 mb-1">Paper Fills (3d)</div>
          <div className="text-lg font-semibold font-mono">
            {loading ? '…' : (health?.recentPerformance?.totalPaperFills ?? 0)}
          </div>
        </div>
        <div className="card">
          <div className="text-xs text-zinc-500 mb-1">Execution Health</div>
          <div className="text-lg font-semibold font-mono">
            {loading ? '…' : `${((health?.execution?.systemHealthScore ?? 1) * 100).toFixed(0)}%`}
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 mb-8">
        <Link href="/markets" className="card hover:border-white/30 transition group">
          <TrendingUp className="h-6 w-6 text-blue-400 mb-4 group-hover:scale-110 transition" />
          <div className="font-semibold mb-1">Markets</div>
          <div className="text-sm text-zinc-400">Browse Polymarket &amp; Kalshi. Open any market for live order books and manual paper fills.</div>
        </Link>

        <Link href="/paper" className="card hover:border-white/30 transition group border-emerald-500/20">
          <Wallet className="h-6 w-6 text-emerald-400 mb-4 group-hover:scale-110 transition" />
          <div className="font-semibold mb-1">Paper Portfolio</div>
          <div className="text-sm text-zinc-400">Open positions, budget, runner control, and per-strategy performance.</div>
        </Link>

        <Link href="/strategies" className="card hover:border-white/30 transition group">
          <Clock className="h-6 w-6 text-amber-400 mb-4 group-hover:scale-110 transition" />
          <div className="font-semibold mb-1">Strategies &amp; Runner</div>
          <div className="text-sm text-zinc-400">Create strategies and start the 24/7 paper runner.</div>
        </Link>

        <Link href="/backtest" className="card hover:border-white/30 transition group">
          <BarChart3 className="h-6 w-6 text-violet-400 mb-4 group-hover:scale-110 transition" />
          <div className="font-semibold mb-1">Backtester</div>
          <div className="text-sm text-zinc-400">Replay strategies on historical snapshots.</div>
        </Link>

        <Link href="/health" className="card hover:border-white/30 transition group">
          <Activity className="h-6 w-6 text-emerald-400 mb-4 group-hover:scale-110 transition" />
          <div className="font-semibold mb-1">System Health</div>
          <div className="text-sm text-zinc-400">Risk mode details, execution quality, Grok recommendations.</div>
        </Link>

        <Link href="/settings" className="card hover:border-white/30 transition group">
          <Sparkles className="h-6 w-6 text-violet-400 mb-4 group-hover:scale-110 transition" />
          <div className="font-semibold mb-1">Settings</div>
          <div className="text-sm text-zinc-400">Grok API key, research agent toggle, and integrations.</div>
        </Link>

        <Link href="/real" className="card hover:border-white/30 transition group opacity-80">
          <Zap className="h-6 w-6 text-red-400 mb-4" />
          <div className="font-semibold mb-1">Real Execution</div>
          <div className="text-sm text-zinc-400">Env-gated real money controls. Paper mode recommended.</div>
        </Link>
      </div>

      {health?.risk?.reason && (
        <div className="card text-sm text-zinc-400">
          <span className="text-zinc-300 font-medium">Status: </span>
          {health.risk.reason}
          {health.timestamp && (
            <span className="text-xs text-zinc-500 ml-2">
              · updated {new Date(health.timestamp).toLocaleTimeString()}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
