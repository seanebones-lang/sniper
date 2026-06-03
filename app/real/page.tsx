'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, AlertTriangle, RefreshCw } from 'lucide-react';

interface RealStatusPayload {
  allowed: boolean;
  envEnabled: boolean;
  killSwitchEnv: boolean;
  hasPolymarketKey: boolean;
  pendingRealTrades: number;
  blockers: string[];
  activeStrategies: number;
  realCapableStrategies: Array<{ id: string; name: string }>;
  polymarketReady: boolean;
  polymarketUsdcBalance?: number | null;
  relayerCredentials?: string;
  tradingSetup?: {
    ready: boolean;
    balanceUsd: number | null;
    relayerMode: string;
    message?: string;
  } | null;
  geoblock?: {
    blocked: boolean;
    country?: string;
    region?: string;
    ip?: string;
    error?: string;
    skipped?: boolean;
  };
  recentPending: Array<{
    id: string;
    platform: string;
    marketExternalId: string;
    side: string;
    status: string;
    createdAt: string;
    txHash: string | null;
  }>;
}

interface LiveOpsSnapshot {
  runner: { running: boolean; lastRun: string | null; lastCycleDurationMs: number | null };
  runnerControl: { desired: string; updatedAt?: string } | null;
  runnerLock: { owner?: string; heartbeatAt?: number } | null;
  killSwitch: { disabled: boolean; reason?: string };
  tradeStats: Array<{ status: string; count: number }>;
  needsReview: Array<{ id: string; side: string; size: string; price: string; marketExternalId: string; createdAt: string }>;
  pendingOrders: Array<{ id: string; side: string; size: string; price: string; marketExternalId: string; createdAt: string; txHash: string | null }>;
  openPositions: Array<{
    marketExternalId: string;
    question: string;
    netSize: number;
    avgEntryPrice: number;
    markPrice: number | null;
    unrealizedPct: number | null;
    onChainSize: number | null;
    openedAt: string;
  }>;
  clobOpenOrders: unknown[];
}

export default function RealExecutionPage() {
  const [confirmed, setConfirmed] = useState(false);
  const [typed, setTyped] = useState('');
  const [status, setStatus] = useState<RealStatusPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [proxyUrl, setProxyUrl] = useState('');
  const [proxyMsg, setProxyMsg] = useState<string | null>(null);
  const [proxySaving, setProxySaving] = useState(false);
  const [cfClearance, setCfClearance] = useState('');
  const [userAgent, setUserAgent] = useState(
    typeof navigator !== 'undefined'
      ? navigator.userAgent
      : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  );
  const [cfSaving, setCfSaving] = useState(false);
  const [cfMsg, setCfMsg] = useState<string | null>(null);
  const [testOrderMsg, setTestOrderMsg] = useState<string | null>(null);
  const [testOrderRunning, setTestOrderRunning] = useState(false);
  const [runnerRunning, setRunnerRunning] = useState<boolean | null>(null);
  const [runnerBusy, setRunnerBusy] = useState(false);
  const [ops, setOps] = useState<LiveOpsSnapshot | null>(null);
  const [apiSecret, setApiSecret] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = sessionStorage.getItem('sniper_api_secret');
    if (stored) setApiSecret(stored);
  }, []);

  function authHeaders(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiSecret.trim()) h.Authorization = `Bearer ${apiSecret.trim()}`;
    return h;
  }

  const canEnable = typed.trim().toUpperCase() === 'I ACCEPT FULL RISK AND RESPONSIBILITY';

  async function loadRunner() {
    try {
      const res = await fetch('/api/runner');
      if (res.ok) {
        const d = (await res.json()) as { running: boolean; executionMode?: string };
        setRunnerRunning(d.running);
      }
    } catch {
      setRunnerRunning(null);
    }
  }

  async function controlRunner(action: 'start' | 'stop') {
    if (action === 'start' && !confirm('Start the LIVE runner? Real orders will be placed when signals fire.')) {
      return;
    }
    setRunnerBusy(true);
    try {
      const res = await fetch('/api/runner', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Runner action failed');
      setRunnerRunning(json.running ?? action === 'start');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Runner action failed');
    } finally {
      setRunnerBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const [statusRes, opsRes] = await Promise.all([
          fetch('/api/real/status'),
          fetch('/api/real/ops'),
        ]);
        if (!statusRes.ok) throw new Error('status fetch failed');
        const data = (await statusRes.json()) as RealStatusPayload;
        if (!cancelled) setStatus(data);
        if (opsRes.ok && !cancelled) {
          setOps((await opsRes.json()) as LiveOpsSnapshot);
        }
      } catch {
        if (!cancelled) setStatus(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    void loadRunner();
    const id = setInterval(() => {
      void load();
      void loadRunner();
    }, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const liveReady = status?.polymarketReady === true;

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
            <li>
              Live Polymarket orders use your wallet via <code>POLYMARKET_PRIVATE_KEY</code> and the CLOB API.
            </li>
            <li>You can lose 100% of the capital allocated to this system.</li>
            <li>Bugs, API changes, bad strategies, or market moves can all cause permanent loss.</li>
            <li>This tool does <span className="font-bold">not</span> guarantee profits.</li>
          </ul>
        </div>

        {status && (
          <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-5 space-y-3">
            <div className="font-semibold text-zinc-200 text-sm">API secret (production)</div>
            <p className="text-zinc-500 text-xs">
              If <code>SNIPER_API_SECRET</code> is set on the server, paste it here for runner and setup actions
              (stored in this browser session only).
            </p>
            <input
              type="password"
              value={apiSecret}
              onChange={(e) => {
                setApiSecret(e.target.value);
                sessionStorage.setItem('sniper_api_secret', e.target.value);
              }}
              placeholder="Bearer token (optional locally)"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm font-mono"
            />
          </div>
        )}

        {status && (
          <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-5 space-y-4">
            <div className="font-semibold text-zinc-200">Live runner</div>
            <p className="text-zinc-400 text-xs">
              When <code>SNIPER_ENABLE_REAL_EXECUTION=true</code>, the runner auto-starts on deploy and
              restarts if it stops (unless you stop it manually here).
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <span className={runnerRunning ? 'text-emerald-400 font-medium' : 'text-zinc-500'}>
                {runnerRunning == null ? '…' : runnerRunning ? 'RUNNING' : 'STOPPED'}
              </span>
              <button
                type="button"
                disabled={runnerBusy}
                onClick={() => void controlRunner(runnerRunning ? 'stop' : 'start')}
                className={`rounded-full px-4 py-2 text-sm font-medium border disabled:opacity-50 ${
                  runnerRunning
                    ? 'border-red-500 text-red-400'
                    : 'border-emerald-500 text-emerald-400'
                }`}
              >
                {runnerBusy ? '…' : runnerRunning ? 'Stop live runner' : 'Start live runner'}
              </button>
              <Link href="/strategies" className="text-xs text-zinc-500 underline hover:text-white">
                Strategy must be LIVE mode →
              </Link>
            </div>
          </div>
        )}

        {status?.geoblock?.blocked && (
          <div className="rounded-xl border border-amber-600/50 bg-amber-950/40 p-5 space-y-3">
            <div className="font-semibold text-amber-200 text-base">Why you have no trades yet</div>
            <p className="text-zinc-300">
              Polymarket blocks order placement from the US (and your server shows{' '}
              <strong>{status.geoblock.country ?? 'restricted'}</strong>). Your wallet (~$
              {status.polymarketUsdcBalance?.toFixed(2) ?? '?'}) is fine — only the server location is wrong.
            </p>
            <p className="text-zinc-400 text-xs">
              Paste an HTTP proxy in an allowed country (e.g. Sweden, Spain, Ireland). Format:{' '}
              <code className="text-zinc-300">http://user:pass@host:port</code> from a provider like Webshare or
              IPRoyal (~$2–5/mo).
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="password"
                autoComplete="off"
                placeholder="http://user:pass@proxy-host:port"
                value={proxyUrl}
                onChange={(e) => setProxyUrl(e.target.value)}
                className="flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={proxySaving || !proxyUrl.trim()}
                className="rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 px-4 py-2 text-sm font-medium text-black"
                onClick={async () => {
                  setProxySaving(true);
                  setProxyMsg(null);
                  try {
                    const res = await fetch('/api/real/proxy', {
                      method: 'POST',
                      headers: authHeaders(),
                      body: JSON.stringify({ url: proxyUrl.trim() }),
                    });
                    const data = (await res.json()) as { message?: string; error?: string };
                    setProxyMsg(data.message ?? data.error ?? (res.ok ? 'Saved' : 'Failed'));
                    const st = await fetch('/api/real/status');
                    if (st.ok) setStatus((await st.json()) as RealStatusPayload);
                  } finally {
                    setProxySaving(false);
                  }
                }}
              >
                {proxySaving ? 'Testing…' : 'Save & test'}
              </button>
            </div>
            {proxyMsg && <p className="text-sm text-amber-100/90">{proxyMsg}</p>}
          </div>
        )}

        <div className="rounded-xl border border-violet-600/40 bg-violet-950/30 p-5 space-y-3">
          <div className="font-semibold text-violet-200">Cloudflare clearance (required for many proxies)</div>
          <p className="text-zinc-400 text-xs leading-relaxed">
            If orders still show &quot;Trading restricted&quot; while geoblock says IE/OK, Polymarket&apos;s WAF is
            blocking the bot. Open{' '}
            <a href="https://polymarket.com" className="text-violet-300 underline" target="_blank" rel="noreferrer">
              polymarket.com
            </a>{' '}
            in Chrome (same network as your proxy), solve any challenge, then DevTools → Application → Cookies →
            copy <code className="text-zinc-300">cf_clearance</code> and your User-Agent from Network headers.
          </p>
          <input
            type="password"
            placeholder="cf_clearance cookie value"
            value={cfClearance}
            onChange={(e) => setCfClearance(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm font-mono"
          />
          <input
            type="text"
            placeholder="User-Agent (auto-filled with this browser)"
            value={userAgent}
            onChange={(e) => setUserAgent(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs font-mono"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={cfSaving || !cfClearance.trim() || !userAgent.trim()}
              className="rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 px-4 py-2 text-sm font-medium"
              onClick={async () => {
                setCfSaving(true);
                setCfMsg(null);
                try {
                  const res = await fetch('/api/real/cloudflare', {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify({
                      cfClearance: cfClearance.trim(),
                      userAgent: userAgent.trim(),
                      testOrder: true,
                    }),
                  });
                  const data = (await res.json()) as {
                    message?: string;
                    error?: string;
                    orderTest?: { success?: boolean; error?: string };
                  };
                  const ot = data.orderTest;
                  setCfMsg(
                    data.message ??
                      data.error ??
                      (ot?.success ? 'Test order accepted by CLOB' : ot?.error ?? 'Saved'),
                  );
                } finally {
                  setCfSaving(false);
                }
              }}
            >
              {cfSaving ? 'Saving…' : 'Save & test order'}
            </button>
            <button
              type="button"
              disabled={testOrderRunning}
              className="rounded-lg border border-white/20 px-4 py-2 text-sm hover:bg-white/5"
              onClick={async () => {
                setTestOrderRunning(true);
                setTestOrderMsg(null);
                try {
                  const res = await fetch('/api/real/test-order', { method: 'POST', headers: authHeaders() });
                  const data = (await res.json()) as { tradingOk?: boolean; hint?: string; error?: string };
                  setTestOrderMsg(data.hint ?? data.error ?? (data.tradingOk ? 'Trading OK' : 'Still blocked'));
                } finally {
                  setTestOrderRunning(false);
                }
              }}
            >
              {testOrderRunning ? 'Testing…' : 'Full test (limit + market)'}
            </button>
          </div>
          {cfMsg && <p className="text-sm text-violet-100/90">{cfMsg}</p>}
          {testOrderMsg && <p className="text-sm text-zinc-300">{testOrderMsg}</p>}
        </div>

        {ops && (
          <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-5 space-y-4">
            <div className="font-semibold text-emerald-300">Live ops</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <div className="text-zinc-500">Runner lock</div>
                <div className="font-mono text-zinc-200 truncate">{ops.runnerLock?.owner?.slice(0, 12) ?? 'none'}</div>
              </div>
              <div>
                <div className="text-zinc-500">Kill switch</div>
                <div className={ops.killSwitch.disabled ? 'text-red-400' : 'text-emerald-400'}>
                  {ops.killSwitch.disabled ? 'OFF' : 'armed'}
                </div>
              </div>
              <div>
                <div className="text-zinc-500">Last cycle</div>
                <div className="font-mono text-zinc-200">
                  {ops.runner.lastRun
                    ? `${Math.round((Date.now() - new Date(ops.runner.lastRun).getTime()) / 1000)}s ago`
                    : '—'}
                </div>
              </div>
              <div>
                <div className="text-zinc-500">Trade stats</div>
                <div className="font-mono text-zinc-200">
                  {ops.tradeStats.map((s) => `${s.status}:${s.count}`).join(' · ') || '—'}
                </div>
              </div>
            </div>

            {ops.openPositions.length > 0 && (
              <div>
                <div className="text-zinc-500 text-xs mb-2">Open positions ({ops.openPositions.length})</div>
                <div className="space-y-2">
                  {ops.openPositions.map((p) => (
                    <div key={p.marketExternalId} className="rounded-lg border border-white/5 bg-black/30 p-3 text-xs">
                      <div className="font-medium text-zinc-200 truncate">{p.question}</div>
                      <div className="font-mono text-zinc-400 mt-1">
                        {p.netSize.toFixed(1)} @ {p.avgEntryPrice.toFixed(4)}
                        {p.markPrice != null && ` → mark ${p.markPrice.toFixed(4)}`}
                        {p.unrealizedPct != null && (
                          <span className={p.unrealizedPct >= 0 ? ' text-emerald-400' : ' text-red-400'}>
                            {' '}
                            ({p.unrealizedPct >= 0 ? '+' : ''}
                            {p.unrealizedPct.toFixed(1)}%)
                          </span>
                        )}
                      </div>
                      {p.onChainSize != null && Math.abs(p.onChainSize - p.netSize) > 1 && (
                        <div className="text-amber-400 mt-1">Chain: {p.onChainSize.toFixed(2)} (ledger mismatch)</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {ops.pendingOrders.length > 0 && (
              <div>
                <div className="text-zinc-500 text-xs mb-2">Pending orders</div>
                {ops.pendingOrders.map((t) => (
                  <div key={t.id} className="font-mono text-[10px] text-zinc-500 mb-1">
                    {t.side} {t.size}@{t.price} {t.marketExternalId.slice(0, 12)}… order=
                    {t.txHash?.slice(0, 10) ?? '—'}
                  </div>
                ))}
              </div>
            )}

            {ops.needsReview.length > 0 && (
              <div className="rounded-lg border border-amber-600/40 bg-amber-950/30 p-3">
                <div className="text-amber-300 text-xs font-medium mb-2">
                  needs_review ({ops.needsReview.length}) — manual attention
                </div>
                {ops.needsReview.map((t) => (
                  <div key={t.id} className="font-mono text-[10px] text-amber-200/80 mb-1">
                    {t.side} {t.size}@{t.price} {t.marketExternalId.slice(0, 12)}…
                  </div>
                ))}
              </div>
            )}

            {Array.isArray(ops.clobOpenOrders) && ops.clobOpenOrders.length > 0 && (
              <div className="text-xs text-zinc-500">
                CLOB open orders: {ops.clobOpenOrders.length} (see Polymarket UI for details)
              </div>
            )}
          </div>
        )}

        <div className="rounded-xl border border-white/10 bg-zinc-950/80 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="font-medium">Live Polymarket Status</div>
            <RefreshCw className={`h-4 w-4 text-zinc-500 ${loading ? 'animate-spin' : ''}`} />
          </div>
          {loading && !status ? (
            <div className="text-zinc-500">Loading server status…</div>
          ) : status ? (
            <div className="space-y-3 text-xs">
              <div className={liveReady ? 'text-emerald-400' : 'text-amber-400'}>
                Polymarket live path:{' '}
                <strong>{liveReady ? 'READY (runner may place real orders)' : 'NOT READY'}</strong>
              </div>
              <ul className="space-y-1 text-zinc-400">
                <li>Env enable: {status.envEnabled ? 'yes' : 'no'} (<code>SNIPER_ENABLE_REAL_EXECUTION</code>)</li>
                <li>Kill switch env: {status.killSwitchEnv ? 'ON (blocked)' : 'off'}</li>
                <li>Runtime allowed: {status.allowed ? 'yes' : 'no'}</li>
                <li>Wallet key configured: {status.hasPolymarketKey ? 'yes' : 'no'}</li>
                <li>
                  Real-capable strategies: {status.realCapableStrategies.length} / {status.activeStrategies}{' '}
                  active
                </li>
                <li>Pending real trades: {status.pendingRealTrades}</li>
                {status.polymarketUsdcBalance != null && (
                  <li>CLOB collateral: ${status.polymarketUsdcBalance.toFixed(2)}</li>
                )}
                {status.relayerCredentials && (
                  <li>Relayer auth: {status.relayerCredentials}</li>
                )}
                {status.tradingSetup?.message && (
                  <li className="text-amber-300/90">Setup: {status.tradingSetup.message}</li>
                )}
                {status.geoblock && (
                  <li className={status.geoblock.blocked ? 'text-red-400' : 'text-emerald-400/90'}>
                    Geoblock:{' '}
                    {status.geoblock.blocked
                      ? `blocked (${[status.geoblock.region, status.geoblock.country].filter(Boolean).join(', ') || 'restricted'}) — use eu-west-1 host`
                      : status.geoblock.skipped
                        ? 'check skipped'
                        : 'OK for this server IP'}
                  </li>
                )}
              </ul>
              <button
                type="button"
                className="mt-2 text-xs text-zinc-400 hover:text-white underline"
                onClick={async () => {
                  setLoading(true);
                  try {
                    await fetch('/api/real/setup', { method: 'POST', headers: authHeaders() });
                    const res = await fetch('/api/real/status');
                    if (res.ok) setStatus((await res.json()) as RealStatusPayload);
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                Run auto-setup (sync balance + gasless approvals)
              </button>
              {status.blockers.length > 0 && (
                <div>
                  <div className="text-zinc-500 mb-1">Blockers:</div>
                  <ul className="list-disc pl-4 text-amber-300/90">
                    {status.blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                    {status.realCapableStrategies.length === 0 && status.envEnabled && (
                      <li>Set <code>paperOnly: false</code> on at least one active strategy (DB/API)</li>
                    )}
                  </ul>
                </div>
              )}
              {status.recentPending.length > 0 && (
                <div className="pt-2 border-t border-white/5">
                  <div className="text-zinc-500 mb-2">Recent pending orders</div>
                  {status.recentPending.map((t) => (
                    <div key={t.id} className="font-mono text-[10px] text-zinc-500 mb-1">
                      {t.platform} {t.side} {t.marketExternalId.slice(0, 12)}… order={t.txHash?.slice(0, 10) ?? '—'}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-red-400">Could not load status from server.</div>
          )}
        </div>

        <div className="pt-4 border-t border-white/10">
          <div className="font-medium mb-3 text-red-400">Explicit Confirmation Required</div>
          <p className="mb-3">Type the following phrase exactly to acknowledge risk in this session:</p>
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
            {canEnable ? 'I UNDERSTAND THE RISKS' : 'Type the exact phrase above to continue'}
          </button>
        </div>

        {confirmed && (
          <div className="rounded-xl border border-red-900 bg-black p-5 text-red-400 text-sm">
            Session acknowledgment recorded. Real orders still require server env + a non-paper strategy.
            {liveReady ? (
              <span className="block mt-2 text-emerald-400">
                Server reports Polymarket live execution is armed. Use minimal sizes.
              </span>
            ) : (
              <span className="block mt-2 text-amber-400">
                Server reports Polymarket is not fully armed yet — resolve blockers above first.
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
