import Link from 'next/link';
import { ArrowLeft, Construction } from 'lucide-react';

export default function DashboardPlaceholder() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white mb-8">
        <ArrowLeft className="h-4 w-4" /> Back to home
      </Link>

      <div className="flex items-center gap-3 mb-4">
        <Construction className="h-8 w-8 text-amber-400" />
        <h1 className="text-4xl font-semibold tracking-tight">Dashboard</h1>
      </div>

      <p className="text-xl text-zinc-400 max-w-prose mb-10">
        This is the future home of the live market browser, strategy configurator, paper/real position tracking, decision log, and 24/7 runner controls.
      </p>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="card">
          <div className="uppercase text-xs tracking-widest text-zinc-500 mb-3">Phase 1–2 Target</div>
          <ul className="space-y-2 text-sm text-zinc-300">
            <li>• Live market search + order book / price views (WS driven)</li>
            <li>• Paper simulator with manual + automated fills</li>
            <li>• Basic position &amp; PnL cards</li>
          </ul>
        </div>
        <div className="card">
          <div className="uppercase text-xs tracking-widest text-zinc-500 mb-3">Phase 3+ Target</div>
          <ul className="space-y-2 text-sm text-zinc-300">
            <li>• Strategy creation + parameter tuning</li>
            <li>• Active 24/7 paper runner with kill switch</li>
            <li>• Full audit log + export</li>
            <li>• Real execution toggle (env + UI guarded)</li>
          </ul>
        </div>
      </div>

      <div className="mt-12 text-xs text-zinc-500 border-t border-white/10 pt-6">
        Current status: Phase 0 complete (scaffold, DB schema, Railway config, strong disclaimers, patterns aligned with your other projects).
        Follow the implementation plan in the session notes or <code>specs/001-sniper-mvp/</code>.
      </div>
    </div>
  );
}
