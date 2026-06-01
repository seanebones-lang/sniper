'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function StrategyHealthPage() {
  const [health, setHealth] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  async function loadHealth() {
    setLoading(true);
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      setHealth(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHealth();
    const interval = setInterval(loadHealth, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <Link href="/strategies" className="flex items-center gap-2 text-sm text-zinc-400 mb-6">
        <ArrowLeft className="h-4 w-4" /> Back to Strategies
      </Link>

      <h1 className="text-4xl font-semibold tracking-tight mb-2">Strategy Health</h1>
      <p className="text-zinc-400 mb-8">Live view of regimes, performance, variants, and system state.</p>

      {loading && !health && <div className="text-zinc-400">Loading health...</div>}

      {health && (
        <div className="space-y-6">
          <div className="card">
            <div className="text-xs text-zinc-500 mb-1">Last Updated</div>
            <div className="font-mono text-sm">{new Date(health.timestamp).toLocaleString()}</div>
          </div>

          {/* Risk Mode Banner */}
          <div className={`card border-2 ${health.risk?.mode === 'EMERGENCY' ? 'border-red-600 bg-red-950/40' : 
            health.risk?.mode === 'DEFENSIVE' ? 'border-amber-500 bg-amber-950/30' : 'border-emerald-600'}`}>
            <div className="flex items-center gap-3">
              <div className="text-lg font-semibold">Current Risk Mode:</div>
              <div className={`px-4 py-1 rounded-full text-sm font-bold tracking-wider
                ${health.risk?.mode === 'EMERGENCY' ? 'bg-red-600 text-white' : 
                  health.risk?.mode === 'DEFENSIVE' ? 'bg-amber-500 text-black' : 'bg-emerald-600 text-white'}`}>
                {health.risk?.mode}
              </div>
              <div className="text-sm text-zinc-400 ml-4">
                Multiplier: <span className="font-mono text-white">{health.risk?.riskMultiplier?.toFixed(2)}x</span>
              </div>
            </div>
            <div className="mt-2 text-sm text-zinc-300">{health.risk?.reason}</div>

            {/* Current Active Restrictions */}
            {health.risk?.mode !== 'NORMAL' && (
              <div className="mt-4 pt-4 border-t border-white/10">
                <div className="font-medium text-sm mb-2">Current Active Restrictions (Risk Mode Effects):</div>
                <ul className="text-sm text-zinc-300 space-y-1 list-disc list-inside">
                  {health.risk?.mode === 'DEFENSIVE' && (
                    <>
                      <li>Markets evaluated reduced to ~12 (instead of 25)</li>
                      <li>Weaker / simpler strategies deprioritized or filtered</li>
                      <li>Extra 25% sizing conservatism layered on top of allocator</li>
                    </>
                  )}
                  {health.risk?.mode === 'EMERGENCY' && (
                    <>
                      <li>Extremely restricted: only 1–2 markets evaluated</li>
                      <li>Only the most proven strategies allowed (mainly OrderBook Imbalance + Resolution Proximity)</li>
                      <li>Very aggressive downweighting (can go as low as 0.35–0.4x)</li>
                      <li>Active recommendation to cancel resting orders on unhealthy markets</li>
                      <li>Most strategies effectively paused</li>
                    </>
                  )}
                </ul>
                <div className="text-[10px] text-zinc-500 mt-2">
                  These restrictions are applied automatically by the runner based on current system health and edge decay signals.
                </div>

                {/* Currently Allowed Strategies Explanation */}
                <div className="mt-3 text-sm text-zinc-300">
                  <strong>Currently Allowed Strategies:</strong><br />
                  {health.risk?.mode === 'NORMAL' && "All active strategies are eligible for evaluation."}
                  {health.risk?.mode === 'DEFENSIVE' && "Weaker / simpler strategies are being deprioritized or skipped. Only stronger, more consistent edges are preferred."}
                  {health.risk?.mode === 'EMERGENCY' && "Only the most proven, highest edge-quality strategies are active (mainly OrderBook Imbalance + Resolution Proximity). Everything else is effectively paused."}
                </div>
              </div>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="card">
              <div className="font-medium mb-3">Recent Performance (3 days)</div>
              <pre className="text-xs bg-black p-4 rounded overflow-auto max-h-64">
                {JSON.stringify(health.recentPerformance, null, 2)}
              </pre>
            </div>

            <div className="card">
              <div className="font-medium mb-3">Active Variants</div>
              {health.activeVariants?.length > 0 ? (
                <div className="space-y-2 text-sm">
                  {health.activeVariants.map((v: any, i: number) => (
                    <div key={i} className="border border-white/10 p-3 rounded">
                      <div className="font-medium">{v.name}</div>
                      <div className="text-xs text-zinc-400">{v.description}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-zinc-400">No active variants yet.</div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="font-medium mb-2">Execution Health</div>
            <div className="text-sm text-zinc-300">
              System Health Score: <span className="font-mono">{health.execution?.systemHealthScore}</span><br />
              Avg Slippage (recent): <span className="font-mono">{health.execution?.averageSlippage}</span><br />
              Unhealthy Markets: {health.execution?.unhealthyMarkets?.length || 0}
            </div>
          </div>

          {/* Recent AI Recommendations */}
          <div className="card">
            <div className="font-medium mb-3">Recent Grok Recommendations (Automated Intelligence)</div>
            {health.aiRecommendations && health.aiRecommendations.length > 0 ? (
              <div className="space-y-4">
                {health.aiRecommendations.map((rec: any, idx: number) => (
                  <div key={idx} className="border border-white/10 rounded p-3 text-sm">
                    <div className="flex justify-between items-start">
                      <div className="text-xs text-zinc-500">
                        {new Date(rec.timestamp).toLocaleString()} • Mode: {rec.riskMode}
                      </div>
                      <div className={`text-[10px] px-2 py-0.5 rounded ${rec.status === 'applied' || rec.status === 'auto_applied' ? 'bg-emerald-900 text-emerald-300' : rec.status === 'ignored' ? 'bg-zinc-800' : 'bg-amber-900 text-amber-300'}`}>
                        {rec.status || 'proposed'}
                      </div>
                    </div>

                    <div className="whitespace-pre-wrap text-zinc-200 text-xs mt-2">
                      {rec.rawText.length > 550 ? rec.rawText.slice(0, 550) + '...' : rec.rawText}
                    </div>

                    {rec.parsedActions?.length > 0 && (
                      <div className="mt-2 text-[10px] text-emerald-400">
                        Parsed actions: {rec.parsedActions.map((a: any) => `${a.action}(${a.target})`).join(', ')}
                      </div>
                    )}

                    {rec.status === 'proposed' && (
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={async () => {
                            await fetch('/api/research/apply-recommendation', {
                              method: 'POST',
                              body: JSON.stringify({ index: rec.index, action: 'apply' }),
                            });
                            window.location.reload();
                          }}
                          className="text-xs px-3 py-1 rounded bg-emerald-700 hover:bg-emerald-600"
                        >
                          Apply
                        </button>
                        <button
                          onClick={async () => {
                            await fetch('/api/research/apply-recommendation', {
                              method: 'POST',
                              body: JSON.stringify({ index: rec.index, action: 'ignore' }),
                            });
                            window.location.reload();
                          }}
                          className="text-xs px-3 py-1 rounded bg-zinc-700 hover:bg-zinc-600"
                        >
                          Ignore
                        </button>
                      </div>
                    )}

                    {rec.outcomeNote && (
                      <div className="mt-2 text-[10px] text-zinc-400">Note: {rec.outcomeNote}</div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-zinc-400">No automated recommendations yet. Enable with ENABLE_GROK_RESEARCH_AGENT=true.</div>
            )}
          </div>

          <div className="card">
            <div className="font-medium mb-2">System Summary</div>
            <div className="text-sm text-zinc-300">
              Active Strategies: {health.summary?.totalActiveStrategies}<br />
              Total Variants: {health.summary?.totalVariants}
            </div>
            <div className="text-[10px] text-zinc-500 mt-4">
              Risk mode now drives real behavioral changes:<br />
              • <strong>DEFENSIVE</strong>: Fewer markets, extra sizing conservatism, weaker strategies deprioritized.<br />
              • <strong>EMERGENCY</strong>: Extremely restricted (only strongest strategies + very few markets) + aggressive downweighting.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
