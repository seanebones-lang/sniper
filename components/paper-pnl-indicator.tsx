'use client';

import Link from 'next/link';
import { Loader2, TrendingDown, TrendingUp } from 'lucide-react';
import type { PaperPnlSnapshot } from '@/lib/paper/portfolio';

export type { PaperPnlSnapshot };

interface PaperPnlIndicatorProps {
  pnl: PaperPnlSnapshot | null | undefined;
  loading?: boolean;
  error?: string | null;
  variant?: 'hero' | 'card';
  className?: string;
}

function formatUsd(n: number, decimals = 2): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatSignedUsd(n: number): string {
  const sign = n >= 0 ? '+' : '−';
  return `${sign}$${formatUsd(Math.abs(n))}`;
}

export function PaperPnlIndicator({
  pnl,
  loading = false,
  error = null,
  variant = 'hero',
  className = '',
}: PaperPnlIndicatorProps) {
  if (loading && !pnl) {
    return (
      <div className={`card border-white/10 ${className}`}>
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading paper simulation P&amp;L…
        </div>
      </div>
    );
  }

  if (error && !pnl) {
    return (
      <div className={`card border-red-500/30 ${className}`}>
        <p className="text-sm text-red-400">P&amp;L unavailable: {error}</p>
      </div>
    );
  }

  if (!pnl) {
    return null;
  }

  const positive = pnl.netPnlUsd >= 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  const color = positive ? 'text-emerald-400' : 'text-red-400';
  const border = positive ? 'border-emerald-500/30 bg-emerald-950/20' : 'border-red-500/30 bg-red-950/20';

  const auditLine = `${pnl.fillsInRun.toLocaleString()} fills (${pnl.buyFills.toLocaleString()} buys · ${pnl.sellFills.toLocaleString()} sells) · ${pnl.openPositions} open · fees $${formatUsd(pnl.totalFeesUsd)} · marks ${pnl.positionsMarked}/${pnl.openPositions}`;

  if (variant === 'card') {
    return (
      <div className={`card ${className}`}>
        <div className="text-xs text-zinc-500 mb-1">Paper P&amp;L (live marks)</div>
        <div className={`text-lg font-semibold font-mono flex items-center gap-1.5 ${color}`}>
          <Icon className="h-4 w-4 shrink-0" />
          {formatSignedUsd(pnl.netPnlUsd)}
        </div>
        <div className={`text-xs font-mono ${color}`}>
          {positive ? '+' : ''}{pnl.netPnlPct.toFixed(2)}%
        </div>
        <div className="text-[10px] text-zinc-600 mt-1 font-mono">
          Equity ${formatUsd(pnl.totalEquityUsd)}
        </div>
      </div>
    );
  }

  return (
    <div className={`card border ${border} ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-xs text-zinc-500 uppercase tracking-wide mb-1">
            Paper P&amp;L · mark-to-market
          </div>
          <div className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 text-3xl sm:text-4xl font-semibold font-mono tracking-tight ${color}`}>
            <Icon className="h-8 w-8 shrink-0 self-center" />
            <span>{formatSignedUsd(pnl.netPnlUsd)}</span>
            <span className="text-xl sm:text-2xl opacity-90">
              ({positive ? '+' : ''}{pnl.netPnlPct.toFixed(2)}%)
            </span>
          </div>

          <div className="grid sm:grid-cols-3 gap-3 mt-4 text-sm font-mono">
            <div className="rounded-lg bg-zinc-950/60 border border-white/5 px-3 py-2">
              <div className="text-[10px] text-zinc-500 uppercase">Realized</div>
              <div className={pnl.realizedPnLUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                {formatSignedUsd(pnl.realizedPnLUsd)}
              </div>
              <div className="text-[10px] text-zinc-600">Closed trades</div>
            </div>
            <div className="rounded-lg bg-zinc-950/60 border border-white/5 px-3 py-2">
              <div className="text-[10px] text-zinc-500 uppercase">Unrealized</div>
              <div className={pnl.unrealizedPnLUsd >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                {formatSignedUsd(pnl.unrealizedPnLUsd)}
              </div>
              <div className="text-[10px] text-zinc-600">Open @ live mid</div>
            </div>
            <div className="rounded-lg bg-zinc-950/60 border border-white/5 px-3 py-2">
              <div className="text-[10px] text-zinc-500 uppercase">Total equity</div>
              <div className="text-zinc-100">${formatUsd(pnl.totalEquityUsd)}</div>
              <div className="text-[10px] text-zinc-600">
                Started ${formatUsd(pnl.startingBudgetUsd, 0)}
              </div>
            </div>
          </div>

          <p className="text-xs text-zinc-500 mt-3 font-mono leading-relaxed">
            Cash ${formatUsd(pnl.cashUsd)} · open marks ${formatUsd(pnl.openMarkValueUsd)} (cost ${formatUsd(pnl.openCostBasisUsd)})
          </p>
          <p className="text-[11px] text-zinc-600 mt-1 font-mono">
            Source: {pnl.source} · {auditLine}
          </p>
          <p className="text-[10px] text-zinc-700 mt-0.5">
            Updated {new Date(pnl.computedAt).toLocaleTimeString()}
            {pnl.marksUpdatedAt && (
              <> · marks {new Date(pnl.marksUpdatedAt).toLocaleTimeString()}</>
            )}
          </p>
        </div>
        <Link
          href="/paper"
          className="text-xs text-emerald-400 hover:text-white underline shrink-0"
        >
          Audit fills →
        </Link>
      </div>
    </div>
  );
}
