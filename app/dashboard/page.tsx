import Link from 'next/link';
import { ArrowLeft, TrendingUp, Shield, Clock } from 'lucide-react';

export default function Dashboard() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white mb-8">
        <ArrowLeft className="h-4 w-4" /> Back to home
      </Link>

      <div className="flex items-center gap-3 mb-3">
        <Shield className="h-8 w-8 text-emerald-400" />
        <h1 className="text-4xl font-semibold tracking-tight">Sniper Dashboard</h1>
      </div>
      <p className="text-lg text-zinc-400 mb-10 max-w-prose">
        Phase 1 complete — public market data + order books working for both platforms.
      </p>

      <div className="grid md:grid-cols-3 gap-5 mb-10">
        <Link href="/markets" className="card hover:border-white/30 transition group">
          <TrendingUp className="h-6 w-6 text-blue-400 mb-4 group-hover:scale-110 transition" />
          <div className="font-semibold mb-1">Markets</div>
          <div className="text-sm text-zinc-400">Live discovery from Polymarket &amp; Kalshi. Click any row for order book.</div>
          <div className="mt-4 text-xs text-emerald-400">Phase 1 ✓</div>
        </Link>

        <div className="card opacity-60">
          <Clock className="h-6 w-6 mb-4" />
          <div className="font-semibold mb-1">Strategies &amp; Runner</div>
          <div className="text-sm text-zinc-400">Configurable paper-first strategies + 24/7 background execution.</div>
          <div className="mt-4 text-xs">Phase 3</div>
        </div>

        <div className="card opacity-60">
          <Shield className="h-6 w-6 mb-4" />
          <div className="font-semibold mb-1">Positions &amp; Logs</div>
          <div className="text-sm text-zinc-400">Paper + real trade history, PnL, kill switches, full audit trail.</div>
          <div className="mt-4 text-xs">Phase 3–4</div>
        </div>
      </div>

      <div className="card bg-zinc-900/40 text-sm">
        <div className="font-medium mb-2">Current Status (Phase 1)</div>
        <ul className="text-zinc-400 space-y-1 text-sm">
          <li>✓ Unified Market + OrderBook types</li>
          <li>✓ Polymarket (Gamma + CLOB SDK) public client</li>
          <li>✓ Kalshi public market + orderbook client (no auth)</li>
          <li>✓ /api/markets + /api/markets/orderbook</li>
          <li>✓ Working markets browser + per-market order book viewer</li>
          <li>✓ Strong risk disclaimers + paper-first posture throughout</li>
        </ul>
        <div className="mt-4 text-xs text-zinc-500">
          Next: Real-time WebSockets (Phase 2) → Strategy engine + paper simulator (Phase 3)
        </div>
      </div>
    </div>
  );
}
