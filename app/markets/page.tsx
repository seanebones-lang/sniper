import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function MarketsPlaceholder() {
  return (
    <div className="max-w-4xl mx-auto p-8">
      <Link href="/dashboard" className="text-sm flex items-center gap-2 text-zinc-400 hover:text-white mb-6"><ArrowLeft className="h-4 w-4" /> Back to Dashboard</Link>
      <h1 className="text-3xl font-semibold mb-2">Markets</h1>
      <p className="text-zinc-400">Unified Polymarket + Kalshi market browser + live data (Phase 1 target).</p>
    </div>
  );
}
