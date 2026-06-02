import Link from 'next/link';
import { Shield, TrendingUp, AlertTriangle, Clock } from 'lucide-react';

export default function SniperLanding() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-20 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1 text-xs tracking-[3px] uppercase mb-6">
          PERSONAL 24/7 TRADING SYSTEM
        </div>

        <h1 className="text-6xl md:text-7xl font-semibold tracking-tighter mb-4">
          SNIPER
        </h1>
        <p className="max-w-xl text-xl text-zinc-400 mb-8">
          Automated buy/sell signals for Polymarket and Kalshi.<br />
          Paper trading first. Real execution heavily guarded.
        </p>

        <div className="flex flex-col sm:flex-row gap-4">
          <Link
            href="/dashboard"
            className="inline-flex h-12 items-center justify-center rounded-full bg-white px-8 font-medium text-black transition hover:bg-zinc-200"
          >
            Open Dashboard
          </Link>
          <a
            href="https://github.com/seanebones-lang/sniper"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-12 items-center justify-center rounded-full border border-white/20 px-8 font-medium transition hover:bg-white/5"
          >
            View on GitHub
          </a>
        </div>

        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl text-left text-sm">
          <div className="card flex flex-col gap-3">
            <Shield className="h-5 w-5 text-emerald-400" />
            <div className="font-medium">Paper Mode Default</div>
            <p className="text-zinc-400">Every strategy runs in realistic simulation first. Real money is an explicit, env-gated opt-in after validation.</p>
          </div>
          <div className="card flex flex-col gap-3">
            <TrendingUp className="h-5 w-5 text-amber-400" />
            <div className="font-medium">Auditable Decisions</div>
            <p className="text-zinc-400">Every signal, fill, and rejection is logged with full market context and reasoning. No black boxes.</p>
          </div>
          <div className="card flex flex-col gap-3">
            <Clock className="h-5 w-5 text-sky-400" />
            <div className="font-medium">Built for 24/7</div>
            <p className="text-zinc-400">WebSocket heartbeats, reconnect logic, circuit breakers, and Railway always-on deployment patterns.</p>
          </div>
        </div>
      </main>

      {/* Strong footer warning */}
      <footer className="border-t border-white/10 py-8 px-6 text-xs text-zinc-500">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row gap-y-3 items-center justify-between">
          <div className="flex items-center gap-2 text-red-400">
            <AlertTriangle className="h-4 w-4" />
            <span>Prediction market trading involves substantial risk of loss. This is not financial advice.</span>
          </div>
          <div>
            Deploy your own instance. Keys never leave your Railway secrets.
          </div>
        </div>
      </footer>
    </div>
  );
}
