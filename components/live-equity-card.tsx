'use client';

import Link from 'next/link';
import { Loader2, Wallet, ExternalLink } from 'lucide-react';

export interface LiveStatusSummary {
  polymarketReady?: boolean;
  polymarketUsdcBalance?: number | null;
  geoblock?: { blocked?: boolean; country?: string };
  blockers?: string[];
  recentPending?: unknown[];
}

interface LiveEquityCardProps {
  status: LiveStatusSummary | null;
  loading?: boolean;
}

export function LiveEquityCard({ status, loading }: LiveEquityCardProps) {
  if (loading && !status) {
    return (
      <div className="card border-red-500/20 mb-6">
        <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
        <span className="text-sm text-zinc-500 ml-2">Loading live Polymarket status…</span>
      </div>
    );
  }

  const bal = status?.polymarketUsdcBalance;
  const ready = status?.polymarketReady === true;
  const geoOk = status?.geoblock?.blocked !== true;

  return (
    <div className="card border-red-500/30 bg-red-950/20 mb-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-red-300 font-medium mb-1">
            <Wallet className="h-5 w-5" />
            Live Polymarket (real money)
          </div>
          <p className="text-xs text-zinc-500 mb-3">
            Paper $10k below is simulation only — not your Polymarket wallet.
          </p>
          <div className="text-3xl font-semibold text-white tabular-nums">
            {bal != null ? `$${bal.toFixed(2)}` : '—'}
            <span className="text-sm font-normal text-zinc-500 ml-2">CLOB cash</span>
          </div>
          <ul className="mt-3 text-xs space-y-1 text-zinc-400">
            <li className={ready ? 'text-emerald-400' : 'text-amber-400'}>
              Trading path: {ready ? 'ready' : 'not ready'}
            </li>
            <li className={geoOk ? 'text-emerald-400' : 'text-red-400'}>
              Location: {geoOk ? `OK (${status?.geoblock?.country ?? 'allowed'})` : 'blocked — check proxy on /real'}
            </li>
            {status?.blockers && status.blockers.length > 0 && (
              <li className="text-amber-300">{status.blockers[0]}</li>
            )}
          </ul>
        </div>
        <Link
          href="/real"
          className="text-xs text-red-300 hover:text-white flex items-center gap-1 shrink-0"
        >
          Real settings <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
