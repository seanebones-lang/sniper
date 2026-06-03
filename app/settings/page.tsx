'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Key, Sparkles, Check, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { jsonAuthHeaders, getStoredApiSecret, setStoredApiSecret } from '@/lib/client/api-secret';

interface SettingsStatus {
  xaiConfigured: boolean;
  xaiSource: 'env' | 'settings' | null;
  xaiMasked: string | null;
  grokResearchEnabled: boolean;
  canEditXaiKey: boolean;
}

export default function SettingsPage() {
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [xaiKey, setXaiKey] = useState('');
  const [grokResearch, setGrokResearch] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [apiSecret, setApiSecret] = useState('');

  useEffect(() => {
    setApiSecret(getStoredApiSecret());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setStatus(data);
            setGrokResearch(data.grokResearchEnabled);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function saveSettings(clearKey = false) {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: jsonAuthHeaders(),
        body: JSON.stringify({
          ...(clearKey ? { clearXaiApiKey: true } : {}),
          ...(xaiKey.trim() ? { xaiApiKey: xaiKey.trim() } : {}),
          enableGrokResearchAgent: grokResearch,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Failed to save settings');
        return;
      }
      setStatus(data);
      setXaiKey('');
      toast.success(clearKey ? 'API key removed' : 'Settings saved');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-10">
      <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white mb-8">
        <ArrowLeft className="h-4 w-4" /> Back to Dashboard
      </Link>

      <div className="flex items-center gap-3 mb-2">
        <Key className="h-7 w-7 text-violet-400" />
        <h1 className="text-4xl font-semibold tracking-tight">Settings</h1>
      </div>
      <p className="text-zinc-400 mb-8">Configure Grok (xAI) for market intel and the research agent.</p>

      {loading && !status && (
        <div className="text-zinc-500 text-sm">Loading…</div>
      )}

      {status && (
        <div className="space-y-6">
          {/* Grok / xAI */}
          <div className="card">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="h-5 w-5 text-violet-400" />
              <div className="font-semibold">Grok API Key (xAI)</div>
            </div>

            {status.xaiConfigured ? (
              <div className="mb-4 flex items-center gap-2 text-sm text-emerald-400">
                <Check className="h-4 w-4" />
                Configured {status.xaiMasked && `(${status.xaiMasked})`}
                {status.xaiSource === 'env' && (
                  <span className="text-zinc-500">· from .env.local</span>
                )}
              </div>
            ) : (
              <p className="text-sm text-zinc-400 mb-4">
                Get a key at{' '}
                <a href="https://console.x.ai" target="_blank" rel="noopener noreferrer" className="underline hover:text-white">
                  console.x.ai
                </a>
                . Stored locally in <code className="text-zinc-300">data/user-settings.json</code> (never sent to the browser after save).
              </p>
            )}

            {status.canEditXaiKey ? (
              <>
                <label className="text-xs text-zinc-500 mb-1 block">XAI API Key</label>
                <input
                  type="password"
                  placeholder="xai-…"
                  value={xaiKey}
                  onChange={(e) => setXaiKey(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-zinc-950 px-4 py-2 text-sm font-mono focus:outline-none focus:border-white/30 mb-4"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => saveSettings()}
                    disabled={saving || !xaiKey.trim()}
                    className="rounded-full bg-white text-black px-5 py-2 text-sm font-medium hover:bg-zinc-200 disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Save API Key'}
                  </button>
                  {status.xaiConfigured && status.xaiSource === 'settings' && (
                    <button
                      onClick={() => saveSettings(true)}
                      disabled={saving}
                      className="flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" /> Remove
                    </button>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-zinc-500">
                Key is managed via <code className="text-zinc-300">XAI_API_KEY</code> in <code className="text-zinc-300">.env.local</code>.
                Remove it there if you want to manage from this page instead.
              </p>
            )}
          </div>

          <div className="card">
            <div className="font-semibold mb-2">API secret (production)</div>
            <p className="text-sm text-zinc-400 mb-4">
              When <code className="text-zinc-300">SNIPER_API_SECRET</code> is set on the server, paste it here so
              runner, strategy, and live setup actions work from the UI. Stored in this browser session only.
            </p>
            <input
              type="password"
              value={apiSecret}
              onChange={(e) => {
                setApiSecret(e.target.value);
                setStoredApiSecret(e.target.value);
              }}
              placeholder="Bearer token"
              className="w-full rounded-lg border border-white/10 bg-zinc-950 px-4 py-2 text-sm font-mono focus:outline-none focus:border-white/30 mb-2"
            />
          </div>

          {/* Research agent toggle */}
          <div className="card">
            <div className="font-semibold mb-2">24/7 Research Agent</div>
            <p className="text-sm text-zinc-400 mb-4">
              When enabled, the background runner periodically asks Grok to analyze strategy performance and suggest adjustments.
            </p>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={grokResearch}
                onChange={(e) => setGrokResearch(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm">Enable Grok Research Agent</span>
            </label>
            <button
              onClick={() => saveSettings()}
              disabled={saving}
              className="mt-4 rounded-full border border-white/20 px-5 py-2 text-sm hover:bg-white/5 disabled:opacity-50"
            >
              Save preference
            </button>
          </div>

          <p className="text-xs text-zinc-500">
            Alternative: set <code className="text-zinc-400">XAI_API_KEY</code> and{' '}
            <code className="text-zinc-400">ENABLE_GROK_RESEARCH_AGENT=true</code> in <code className="text-zinc-400">.env.local</code> and restart the dev server.
          </p>
        </div>
      )}
    </div>
  );
}
