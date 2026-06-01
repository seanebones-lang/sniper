import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function StrategiesPlaceholder() {
  return (
    <div className="max-w-4xl mx-auto p-8">
      <Link href="/dashboard" className="text-sm flex items-center gap-2 text-zinc-400 hover:text-white mb-6"><ArrowLeft className="h-4 w-4" /> Back to Dashboard</Link>
      <h1 className="text-3xl font-semibold mb-2">Strategies</h1>
      <p className="text-zinc-400">Create, edit, and activate paper-first automated strategies (Phase 3 target).</p>
    </div>
  );
}
