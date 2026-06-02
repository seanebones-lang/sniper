'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft, AlertTriangle } from 'lucide-react';

export default function RealExecutionPage() {
  const [confirmed, setConfirmed] = useState(false);
  const [typed, setTyped] = useState('');
  const realEnabled = process.env.NEXT_PUBLIC_REAL_EXECUTION_ENABLED === 'true'; // placeholder

  const canEnable = typed.trim().toUpperCase() === 'I ACCEPT FULL RISK AND RESPONSIBILITY';

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <Link href="/strategies" className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white mb-6">
        <ArrowLeft className="h-4 w-4" /> Back to Strategies
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <AlertTriangle className="h-8 w-8 text-red-500" />
        <h1 className="text-4xl font-semibold tracking-tight text-red-400">Real Money Execution</h1>
      </div>

      <div className="space-y-6 text-sm leading-relaxed text-zinc-300">
        <div className="rounded-xl border border-red-900 bg-red-950/60 p-6">
          <div className="font-semibold text-red-400 text-lg mb-3">THIS IS REAL CAPITAL AT RISK</div>
          <ul className="list-disc pl-5 space-y-2 text-red-300/90">
            <li>Enabling real execution means the runner can place actual orders on <strong>Polymarket</strong> using your keys. Kalshi real execution is not implemented.</li>
            <li>You can lose 100% of the capital allocated to this system.</li>
            <li>Bugs, API changes, bad strategies, or market moves can all cause permanent loss.</li>
            <li>This tool does <span className="font-bold">not</span> guarantee profits. Most automated traders lose money.</li>
          </ul>
        </div>

        <div>
          <div className="font-medium mb-2">Current Status</div>
          <div className={realEnabled ? 'text-red-400' : 'text-emerald-400'}>
            Real execution is currently <strong>{realEnabled ? 'ENABLED' : 'DISABLED'}</strong> in this deployment.
          </div>
          <div className="text-xs text-zinc-500 mt-1">
            Server flag: <code>SNIPER_ENABLE_REAL_EXECUTION=true</code> in environment (Railway secrets, <code>.env.local</code>).
            This page does not read that flag yet — check your deployment config directly.
          </div>
        </div>

        <div className="pt-4 border-t border-white/10">
          <div className="font-medium mb-3 text-red-400">Explicit Confirmation Required</div>
          <p className="mb-3">If you still want to proceed with real execution capability, type the following phrase exactly:</p>
          <div className="font-mono bg-zinc-950 border border-white/10 p-3 mb-4 text-red-300">
            I ACCEPT FULL RISK AND RESPONSIBILITY
          </div>

          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Type the confirmation phrase here"
            className="w-full bg-black border border-red-900/60 rounded-lg px-4 py-3 font-mono text-sm mb-4 focus:outline-none"
          />

          <button
            disabled={!canEnable}
            onClick={() => setConfirmed(true)}
            className="w-full rounded-full bg-red-600 disabled:bg-zinc-800 py-3 font-medium text-sm disabled:text-zinc-500"
          >
            {canEnable ? 'I UNDERSTAND AND WANT TO ENABLE REAL EXECUTION PATHS' : 'Type the exact phrase above to continue'}
          </button>
        </div>

        {confirmed && (
          <div className="rounded-xl border border-red-900 bg-black p-5 text-red-400 text-sm">
            Real execution paths are now conceptually unlocked in this session. 
            The actual runner will still only use real orders when both the env flag is set AND a strategy has <code>paperOnly: false</code>.
            <br /><br />
            Proceed with extreme caution. Start with the smallest possible sizes.
          </div>
        )}
      </div>

      <div className="mt-10 text-[10px] text-zinc-500">
        This page exists because Phase 4 of the original plan requires heavy, explicit warnings before any real capital path is active.
      </div>
    </div>
  );
}
