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
          <div className="font-semibold mb-1">Markets + Live Snipe</div>
          <div className="text-sm text-zinc-400">Real-time order books (Polymarket WS). Click any market for live view + manual paper snipe simulator.</div>
          <div className="mt-4 text-xs text-emerald-400">Phase 2 ✓</div>
        </Link>

        <Link href="/strategies" className="card hover:border-white/30 transition">
          <Clock className="h-6 w-6 mb-4" />
          <div className="font-semibold mb-1">Strategies &amp; 24/7 Runner</div>
          <div className="text-sm text-zinc-400">Create strategies and start the autonomous paper runner. Telegram alerts supported.</div>
          <div className="mt-4 text-xs text-emerald-400">Phase 3 ✓</div>
        </Link>

        <Link href="/backtest" className="card hover:border-white/30 transition">
          <Shield className="h-6 w-6 mb-4" />
          <div className="font-semibold mb-1">Backtester + Real Controls</div>
          <div className="text-sm text-zinc-400">Test strategies on price series. Real execution available behind heavy gates (/real).</div>
          <div className="mt-4 text-xs text-amber-400">Phase 4 ✓</div>
        </Link>
      </div>

      <div className="card bg-zinc-900/40 text-sm">
        <div className="font-medium mb-2">Current Status (Phase 2)</div>
        <ul className="text-zinc-400 space-y-1 text-sm">
          <li>✓ All Phase 1 market data infrastructure</li>
          <li>✓ Polymarket WebSocket client (price_change + book, heartbeats, reconnect)</li>
          <li>✓ Kalshi WebSocket client stub</li>
          <li>✓ Live updating order books on individual market pages</li>
          <li>✓ Paper simulator with manual snipe + in-session fill log</li>
        </ul>
        <div className="mt-4 text-xs text-emerald-400 font-medium">
          Phase 2 complete. Ready for automated strategies + background runner (Phase 3).
        </div>
      </div>
    </div>
  );
}
