/**
 * Post-cycle intelligence (Grok, etc.) — must never block the runner loop.
 */
import { loadSystemState, persistSystemState } from '@/lib/monitoring/system-state';

const GROK_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const GROK_TIMEOUT_MS = 90_000;

export type PostCycleIntelligenceParams = {
  liveRealActive: boolean;
  cycleBankrollUsd: number;
  systemHealth: number;
  adverseRate: number;
  activeStrategyIds: string[];
  allowedStrategyRows: Array<{ id: string; paperOnly: boolean | null }>;
};

async function shouldRunGrokNow(liveRealActive: boolean, cycleBankrollUsd: number): Promise<boolean> {
  const { getGrokResearchEnabled } = await import('@/lib/settings/keys');
  if (!(await getGrokResearchEnabled())) return false;

  const state = await loadSystemState<{ lastGrokAt?: string; lastForcedGrokAt?: string }>(
    'live_intelligence',
  );
  const lastAt = state?.lastGrokAt ? new Date(state.lastGrokAt).getTime() : 0;
  const cooledDown = Date.now() - lastAt > GROK_COOLDOWN_MS;

  let forceLive = false;
  if (liveRealActive && cooledDown) {
    const { analyzeLiveRoundTrips } = await import('@/lib/execution/real-strategy-pnl');
    const attr = await analyzeLiveRoundTrips(48);
    const lastForced = state?.lastForcedGrokAt ? new Date(state.lastForcedGrokAt).getTime() : 0;
    const forceCooldownOk = Date.now() - lastForced > GROK_COOLDOWN_MS;
    forceLive =
      forceCooldownOk &&
      attr.losses >= 3 &&
      attr.totalPnlUsd < -0.06 * cycleBankrollUsd;
  }

  const scheduled = Date.now() % (6 * 60 * 60 * 1000) < 120_000;
  return forceLive || (cooledDown && scheduled);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

export function runPostCycleIntelligence(params: PostCycleIntelligenceParams): void {
  void (async () => {
    const run = await shouldRunGrokNow(params.liveRealActive, params.cycleBankrollUsd);
    if (!run) return;

    try {
      const { askGrokResearchAgent } = await import('@/lib/research/grok-agent');
      const { executionManager } = await import('@/lib/execution/execution-manager');
      const { riskModeManager } = await import('@/lib/monitoring/risk-mode');
      const { storeRecommendations } = await import('@/lib/monitoring/ai-recommendations');
      const { db, auditEvents } = await import('@/lib/db');

      const recentExec = executionManager.getRecentExecutionQuality(20);
      const avgSlip = executionManager.getAverageSlippage(30);
      const unhealthy = executionManager.getUnhealthyMarkets(0.5);
      const currentRisk = riskModeManager.getCurrentMode();
      const primaryStrategy = params.activeStrategyIds[0];

      const analysis = await withTimeout(
        askGrokResearchAgent({
          type: 'strategy_analysis',
          strategyId: primaryStrategy,
          lookbackHours: 48,
          extraContext: `Background post-cycle. Risk: ${currentRisk.current}. Health: ${(params.systemHealth * 100).toFixed(1)}%. Adverse: ${(params.adverseRate * 100).toFixed(1)}%.`,
        }),
        GROK_TIMEOUT_MS,
        'Grok research',
      );

      await db.insert(auditEvents).values({
        actor: 'runner',
        action: 'grok_research_agent',
        payload: {
          background: true,
          analysisPreview: analysis.analysis.slice(0, 1500),
        },
      });

      if (analysis.analysis.includes('RECOMMENDED ACTIONS')) {
        const actionsSection = analysis.analysis.split('RECOMMENDED ACTIONS')[1] || '';
        const stored = storeRecommendations(actionsSection, currentRisk.current);

        const liveActive = params.allowedStrategyRows.some((s) => s.paperOnly === false);
        if (liveActive) {
          const { applySafeGrokActionsForLive } = await import('@/lib/monitoring/live-intelligence');
          const { analyzeLiveRoundTrips } = await import('@/lib/execution/real-strategy-pnl');
          const liveAttr = await analyzeLiveRoundTrips(48);
          const applied = await applySafeGrokActionsForLive(stored.parsedActions, {
            systemHealth: params.systemHealth,
            recentPnlUsd: liveAttr.totalPnlUsd,
            bankrollUsd: params.cycleBankrollUsd,
          });
          if (applied.length > 0) {
            console.warn(`[Runner] Grok live-safe (background): ${applied.join(', ')}`);
          }
        }
      }

      const intel = await loadSystemState<Record<string, unknown>>('live_intelligence');
      await persistSystemState(
        'live_intelligence',
        { ...intel, lastGrokAt: new Date().toISOString() },
        'Grok background complete',
      );
    } catch (e) {
      console.warn('[Runner] Background Grok failed (non-fatal):', e);
    }
  })();
}
