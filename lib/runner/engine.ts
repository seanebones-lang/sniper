/**
 * Strategy Engine + Background Runner (Phase 3)
 * This is the core that makes the system "know when to buy and sell".
 *
 * Arch note: ~580 LOC orchestrates riskMode, portfolioRisk, executionManager, recon, Grok agent, snapshots, dynamic alloc.
 * If adding significantly more (e.g. full WS strategies), consider splitting into RiskOrchestrator + EvaluationLoop.
 */

import { db, strategies, signals, paperTrades, auditEvents } from '@/lib/db'; // eslint-disable-line @typescript-eslint/no-unused-vars -- strategies used via db.query.strategies (Drizzle table ref)
import { getAllMarkets, ensureMarketRecord } from '@/lib/markets';
import { fetchPolymarketOrderBook } from '@/lib/clients/polymarket';
import { fetchKalshiOrderBook } from '@/lib/clients/kalshi';
// TODO: Deeper Kalshi WS integration in runner (currently wired in UI only)
import { getStrategy } from '@/lib/strategies';
import { paperSimulator } from '@/lib/execution/paper-simulator';
import type { StrategyConfig } from '@/lib/strategies/types';
import { alerts } from '@/lib/alerts/telegram';
import { portfolioRiskManager } from '@/lib/risk/portfolio-manager';
import { categorizeMarket } from '@/lib/risk/categorizer';
import { saveBookSnapshot } from '@/lib/data/historical';
import { getDynamicAllocations } from '@/lib/strategies/allocator';
import { extractFeaturesFromRecentSnapshots } from '@/lib/data/features';
import { executionManager } from '@/lib/execution/execution-manager';
import { edgeDecayMonitor } from '@/lib/monitoring/edge-decay';
import { riskModeManager } from '@/lib/monitoring/risk-mode';
import { storeRecommendations } from '@/lib/monitoring/ai-recommendations';
import { 
  applyTemporaryAdjustment, 
  cleanupExpiredAdjustments, 
  getEffectiveGlobalRiskMultiplier,
  getStrategySizeMultiplier,
} from '@/lib/monitoring/temporary-adjustments';

export interface RunnerStatus {
  running: boolean;
  lastRun: string | null;
  signalsGenerated: number;
  fillsExecuted: number;
}

const status: RunnerStatus = {
  running: false,
  lastRun: null,
  signalsGenerated: 0,
  fillsExecuted: 0,
};

let interval: NodeJS.Timeout | null = null;

export function getRunnerStatus(): RunnerStatus {
  return { ...status };
}

export async function startRunner(intervalMs = 15000) {
  if (status.running) return;

  status.running = true;
  console.log('[Runner] Starting 24/7 paper runner...');

  // === Durable Safety State Recovery (critical for real capital) ===
  try {
    const { loadCriticalSafetyState } = await import('@/lib/monitoring/system-state');
    const safety = await loadCriticalSafetyState();

    if (safety.killSwitch.disabled) {
      console.warn('🚨 [Runner] KILL SWITCH RECOVERED FROM PERSISTED STATE');
      console.warn(`   Reason: ${safety.killSwitch.reason}`);
      console.warn(`   Disabled at: ${safety.killSwitch.disabledAt}`);
      // The real-executor will respect the persisted state on next isRealExecutionAllowed() call
    }

    if (safety.riskMode.current !== 'NORMAL') {
      console.warn(`⚠️ [Runner] RISK MODE RECOVERED: ${safety.riskMode.current} — ${safety.riskMode.reason}`);
    }
  } catch (e) {
    console.warn('[Runner] Could not load durable safety state (non-fatal):', e);
  }

  alerts.runnerStarted();

  // Run immediately
  await runOnce();

  interval = setInterval(async () => {
    try {
      await runOnce();
    } catch (e) {
      console.error('[Runner] Error in loop:', e);
    }
  }, intervalMs);
}

export function stopRunner() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  status.running = false;
  console.log('[Runner] Stopped');
  alerts.runnerStopped();
}

export async function runOnce() {
  if (!status.running) return;

  const activeStrategies = await db.query.strategies.findMany({
    where: (s, { eq }) => eq(s.isActive, true),
  });

  if (activeStrategies.length === 0) {
    return;
  }

  const markets = await getAllMarkets();

  // === Ensure all markets we are about to evaluate are persisted (critical for signal FKs) ===
  // This is cheap due to onConflictDoUpdate and prevents the historic FK mismatch bug.
  try {
    const { syncMarketsToDb } = await import('@/lib/markets');
    await syncMarketsToDb(markets);
  } catch (syncErr) {
    console.warn('[Runner] Non-fatal: failed to sync markets to DB before evaluation', syncErr);
  }

  // === Calculate global and per-market protection factors upfront ===
  const recentQuality = executionManager.getRecentExecutionQuality(30);
  const badSlippage = recentQuality.filter(q => q.slippage > 0.006).length;
  const adverseRate = recentQuality.length > 0 ? badSlippage / recentQuality.length : 0;

  const systemHealth = executionManager.getSystemHealthScore();
  const unhealthyMarkets = executionManager.getUnhealthyMarkets(0.45);

  // Clean up any expired temporary adjustments from previous Grok recommendations
  const expiredAdjustments = cleanupExpiredAdjustments();
  if (expiredAdjustments.length > 0) {
    console.log(`[Runner] Reverted ${expiredAdjustments.length} expired temporary adjustment(s)`);
  }

  let globalRiskMultiplier = getEffectiveGlobalRiskMultiplier(1.0);

  // === Risk Mode Evaluation ===
  const decayingCount = activeStrategies.filter(s => edgeDecayMonitor.isDecaying(s.id).decaying).length;
  const riskModeResult = riskModeManager.evaluate(
    systemHealth,
    adverseRate,
    decayingCount,
    unhealthyMarkets.length
  );

  if (riskModeResult.changed) {
    const emoji = riskModeResult.newMode === 'EMERGENCY' ? '🚨' : riskModeResult.newMode === 'DEFENSIVE' ? '⚠️' : '✅';
    console.warn(`${emoji} [Runner] RISK MODE TRANSITION → ${riskModeResult.newMode} (was ${riskModeManager.getCurrentMode().previousMode})`);
    console.warn(`   Reason: ${riskModeResult.reason}`);
    console.warn(`   Effect: Strategy selection and market limits are now being restricted according to the new mode.`);
    await logAudit('risk_mode_change', {
      newMode: riskModeResult.newMode,
      previousMode: riskModeManager.getCurrentMode().previousMode,
      reason: riskModeResult.reason,
    });
  }

  globalRiskMultiplier = riskModeManager.getRiskMultiplier();

  let signalsThisRun = 0;
  let fillsThisRun = 0;

  for (const stratRow of activeStrategies) {
    const strategyImpl = getStrategy(stratRow.type);
    if (!strategyImpl) continue;

    const config = stratRow.config as unknown as StrategyConfig;

    // === Risk Mode Behavioral Adaptation ===
    const currentRiskMode = riskModeManager.getCurrentMode();
    let marketEvaluationLimit = 25;
    let allowedStrategies = activeStrategies;

    if (currentRiskMode.current === 'DEFENSIVE') {
      marketEvaluationLimit = 12;
      // In defensive mode, prefer stronger/more consistent strategies (simple heuristic for now)
      allowedStrategies = activeStrategies.filter(s => 
        !['threshold'].includes(s.type) // example: deprioritize simpler strategies
      );
      if (allowedStrategies.length === 0) allowedStrategies = activeStrategies;

      console.warn(`⚠️ [Runner] DEFENSIVE MODE — evaluating only ${allowedStrategies.length} strategy(ies) across ${marketEvaluationLimit} markets with extra conservatism`);
    }

    if (currentRiskMode.current === 'EMERGENCY') {
      marketEvaluationLimit = 2;

      // Define the absolute survival set — only the most proven, battle-tested edges
      const SURVIVAL_STRATEGY_TYPES = ['orderbook-imbalance', 'resolution-proximity'];

      allowedStrategies = activeStrategies.filter(s => 
        SURVIVAL_STRATEGY_TYPES.includes(s.type)
      );

      if (allowedStrategies.length === 0) {
        allowedStrategies = activeStrategies.slice(0, 1);
      }

      // In deep emergency, collapse to the absolute minimum
      if (systemHealth < 0.38) {
        marketEvaluationLimit = 1;
        allowedStrategies = allowedStrategies.slice(0, 1);
      }

      const pausedStrategies = activeStrategies.filter(s => !allowedStrategies.some(a => a.id === s.id));

      console.warn(`🚨 [Runner] EMERGENCY MODE — survival posture only.`);
      if (pausedStrategies.length > 0) {
        console.warn(`   PAUSED STRATEGIES due to Emergency: ${pausedStrategies.map(s => s.name).join(', ')}`);
      }
      console.warn(`   Evaluating only ${allowedStrategies.length} strategy(ies) across ${marketEvaluationLimit} market(s).`);
    }

    const allocations = await getDynamicAllocations(allowedStrategies.map(s => s.id));
    let allocation = allocations[stratRow.id] || { weight: 0.7, maxSizeMultiplier: 0.8, reason: 'Default' };

    // Further conservatism in worse risk modes
    if (currentRiskMode.current === 'DEFENSIVE') {
      allocation = {
        ...allocation,
        maxSizeMultiplier: allocation.maxSizeMultiplier * 0.75,
        reason: allocation.reason + ' + Defensive mode conservatism'
      };
    }
    if (currentRiskMode.current === 'EMERGENCY') {
      allocation = {
        ...allocation,
        maxSizeMultiplier: allocation.maxSizeMultiplier * 0.4,
        reason: allocation.reason + ' + Emergency mode conservatism'
      };
    }

    // Reduce market sample based on risk mode
    const relevantMarkets = markets
      .filter(m => m.status === 'open')
      .slice(0, marketEvaluationLimit);

    for (const market of relevantMarkets) {
      try {
        // Get fresh book/price
        const book = market.platform === 'polymarket'
          ? await fetchPolymarketOrderBook(market.externalId)
          : await fetchKalshiOrderBook(market.externalId);

        const currentPrice = book.mid ?? market.lastPrice;

        // === Self-Protection: Execution Health Throttle ===
        const marketHealth = executionManager.getMarketHealth(market.externalId);
        let healthMultiplier = 1.0;

        if (marketHealth.healthScore < 0.5) {
          healthMultiplier = Math.max(0.15, marketHealth.healthScore * 0.8);
          console.warn(`[Runner] Downweighting ${market.externalId} — poor execution health (${(marketHealth.healthScore * 100).toFixed(0)}%, ${marketHealth.recentAdverseCount}/${marketHealth.recentFills} adverse)`);
        }

        // === Rich feature collection for research & future ML ===
        if (book && (book.bids?.length || book.asks?.length)) {
          const topBid = book.bids?.[0]?.size || 0;
          const topAsk = book.asks?.[0]?.size || 0;
          const imbalance = topBid / (topBid + topAsk + 0.0001);

          // Compute advanced features (in production we would query recent snapshots for this market)
          const advanced = extractFeaturesFromRecentSnapshots([]);

          await saveBookSnapshot({
            platform: market.platform,
            marketExternalId: market.externalId,
            bids: book.bids?.slice(0, 3) || [],
            asks: book.asks?.slice(0, 3) || [],
            mid: book.mid || currentPrice || 0,
            spread: book.spread || 0,
            timestamp: new Date(),
            imbalance: parseFloat(imbalance.toFixed(4)),
            topDepth: topBid + topAsk,
            extra: {
              regime: advanced.regime,
              volatilityProxy: advanced.volatilityProxy,
              imbalancePersistence: advanced.imbalancePersistence,
            },
          } as unknown as Parameters<typeof saveBookSnapshot>[0]);
        }

        const signal = strategyImpl.evaluate(
          { market, book, currentPrice },
          config
        );

        if (signal && signal.action !== 'HOLD') {
          signalsThisRun++;

          // === ADVANCED RISK SIZING (applied to both paper and real) ===
          const categoryInfo = categorizeMarket(market.question, market.platform, market.externalId);
          const riskDecision = await portfolioRiskManager.calculateSafeSize({
            platform: market.platform,
            marketExternalId: market.externalId,
            side: signal.action as 'BUY' | 'SELL',
            edge: signal.edge ?? (signal.confidence ? (signal.confidence - 0.5) * 2 : 0.025),
            confidence: signal.confidence ?? 0.65,
            category: categoryInfo.category,
            currentPrice: signal.price,
          });

          if (riskDecision.allowedSize < 5) {
            await logAudit('runner_signal_rejected_risk', {
              strategy: stratRow.name,
              market: market.externalId,
              signal,
              reason: riskDecision.reason,
            });
            continue; // Skip this signal
          }

          let allocatorMultiplier = allocation.maxSizeMultiplier || 0.85;

          // Apply any temporary strategy-specific downweights from Grok recommendations
          allocatorMultiplier = getStrategySizeMultiplier(stratRow.id, allocatorMultiplier);

          await logAudit('runner_allocator_decision', {
            strategy: stratRow.name,
            allocation: allocation.reason,
            multiplier: allocatorMultiplier,
          });

          const finalSize = Math.min(signal.size, riskDecision.allowedSize) * allocatorMultiplier * healthMultiplier * globalRiskMultiplier;

          // Persist signal (with risk-adjusted size)
          let sizeReason = '';
          if (healthMultiplier < 0.95) sizeReason += ` | Health throttle ${healthMultiplier.toFixed(2)}`;
          if (globalRiskMultiplier < 0.95) sizeReason += ` | Global risk ${globalRiskMultiplier.toFixed(2)}`;

          // === CRITICAL: Ensure market exists in DB before creating signal (fixes FK mismatch) ===
          let marketDbId: string;
          try {
            marketDbId = await ensureMarketRecord(market);
          } catch (ensureErr) {
            console.error(`[Runner] Failed to ensure market record for ${market.platform}:${market.externalId}`, ensureErr);
            await logAudit('runner_market_ensure_failed', {
              strategy: stratRow.name,
              market: market.externalId,
              error: String(ensureErr),
            });
            continue; // Skip this signal — cannot create valid FK reference
          }

          const insertedSignal = await db.insert(signals).values({
            strategyId: stratRow.id,
            marketId: marketDbId,
            action: signal.action as 'BUY' | 'SELL' | 'CANCEL',
            price: signal.price.toString(),
            size: finalSize.toString(),
            reason: `${signal.reason} | Risk-adjusted from ${signal.size} → ${finalSize.toFixed(0)}${sizeReason}`,
          }).returning({ id: signals.id });

          const signalId = insertedSignal[0]?.id;

          await logAudit('runner_signal_created', {
            strategy: stratRow.name,
            market: market.externalId,
            marketDbId,
            signalId,
            action: signal.action,
            size: finalSize,
          });

          const isRealAllowed = process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true' && !stratRow.paperOnly;

          if (isRealAllowed) {
            // Real execution path (Phase 4+)
            const { placeRealOrder } = await import('@/lib/execution/real-executor');
            const result = await placeRealOrder({
              market,
              side: signal.action as 'BUY' | 'SELL',
              price: signal.price,
              size: finalSize,
              reason: `[REAL][${stratRow.name}] ${signal.reason} (risk-adjusted)`,
            });

            if (result.success) {
              fillsThisRun++;
              status.fillsExecuted++;
              alerts.realOrder({
                platform: market.platform,
                side: signal.action,
                size: signal.size,
                price: signal.price,
                reason: signal.reason,
              });
            }
          } else {
            // Paper execution (default safe path)
            const fill = paperSimulator.snipe({
              market,
              side: signal.action as 'BUY' | 'SELL',
              price: signal.price,
              size: finalSize,
              reason: `[${stratRow.name}] ${signal.reason} (risk-adjusted)`,
            });

            if (fill) {
              fillsThisRun++;

              await db.insert(paperTrades).values({
                platform: market.platform,
                marketExternalId: market.externalId,
                signalId: signalId ?? null, // Now properly linked (was previously impossible due to FK bug)
                side: fill.side,
                price: fill.price.toString(),
                size: fill.size.toString(),
                fee: fill.fee.toString(),
                status: 'filled',
              });

              alerts.paperFill(fill);
            }
          }
        }
      } catch (e) {
        // Don't let one bad market kill the runner
        console.warn(`[Runner] Error on ${market.externalId}:`, e);
        await logAudit('runner_market_error', {
          market: market.externalId,
          strategy: stratRow.name,
          error: e instanceof Error ? e.message : String(e),
          stack: e instanceof Error ? e.stack?.slice(0, 500) : undefined,
        });
      }
    }
  }

  status.lastRun = new Date().toISOString();
  status.signalsGenerated += signalsThisRun;
  status.fillsExecuted += fillsThisRun;

  if (signalsThisRun > 0) {
    console.log(`[Runner] Run complete. Signals: ${signalsThisRun}, Paper fills: ${fillsThisRun}`);
  }

  // === Edge Decay Monitoring (lightweight) ===
  for (const strat of activeStrategies) {
    const decay = edgeDecayMonitor.isDecaying(strat.id);
    if (decay.decaying) {
      console.warn(`[Runner] EDGE DECAY on ${strat.name}: ${decay.reason}`);
      await logAudit('edge_decay_detected', {
        strategy: strat.name,
        severity: decay.severity,
        reason: decay.reason,
      });
    }
  }

  // Periodic portfolio health log (every ~10 runs on average)
  if (Math.random() < 0.1) {
    const state = await portfolioRiskManager.getCurrentPortfolioState();
    console.log(`[Runner] Portfolio health: Exposure $${state.totalExposureUsd.toFixed(0)} | Open positions: ${state.openPositions}`);
  }

  // === Real Trade Reconciliation (important for live execution) ===
  if (process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true') {
    try {
      const { reconcilePendingRealTrades } = await import('@/lib/execution/reconcile-real-trades');
      const recon = await reconcilePendingRealTrades();
      if (recon.checked > 0) {
        console.log(`[Runner] Real trade reconciliation: checked=${recon.checked}, updated=${recon.updated}, errors=${recon.errors}`);
      }
    } catch (reconErr) {
      console.warn('[Runner] Reconciliation error (non-fatal):', reconErr);
    }
  }

  // === Automated Intelligence Layer: Periodic Grok Analysis with Concrete Actions ===
  // Trigger roughly every 6-8 hours when enabled (more deterministic than pure random)
  const shouldRunGrokAnalysis = process.env.ENABLE_GROK_RESEARCH_AGENT === 'true' &&
    (Math.random() < 0.008 || (Date.now() % (6 * 60 * 60 * 1000) < 120000)); // ~every 6h or on lucky runs

  if (shouldRunGrokAnalysis) {
    try {
      const { askGrokResearchAgent } = await import('@/lib/research/grok-agent');

      // Build rich context for the agent
      const recentExec = executionManager.getRecentExecutionQuality(20);
      const avgSlip = executionManager.getAverageSlippage(30);
      const unhealthy = executionManager.getUnhealthyMarkets(0.5);
      const currentRisk = riskModeManager.getCurrentMode();

      const analysis = await askGrokResearchAgent({
        type: 'strategy_analysis',
        lookbackHours: 48,
        extraContext: `Current risk mode: ${currentRisk.current} (${currentRisk.reason}). 
System health score: ${(systemHealth * 100).toFixed(1)}%. 
Recent adverse fill rate: ${(adverseRate * 100).toFixed(1)}%. 
Unhealthy markets: ${unhealthy.length} (${unhealthy.join(', ') || 'none'}). 
Avg recent slippage: ${avgSlip.toFixed(4)}. 
Recent execution samples: ${JSON.stringify(recentExec.slice(-8))}`,
      });

      await logAudit('grok_research_agent', { 
        fullAnalysis: analysis.analysis.slice(0, 2000),
        proposals: analysis.proposals || [],
        riskModeAtTime: currentRisk.current,
      });

      console.log('[Runner] Grok Research Agent analysis completed.');

      // Parse and surface concrete recommendations
      if (analysis.analysis.includes('RECOMMENDED ACTIONS')) {
        const actionsSection = analysis.analysis.split('RECOMMENDED ACTIONS')[1] || '';
        console.warn(`[Runner] Grok Recommended Actions:\n${actionsSection.trim().slice(0, 1200)}`);

        const stored = storeRecommendations(actionsSection, currentRisk.current);

        await logAudit('grok_recommended_actions', {
          raw: actionsSection.trim().slice(0, 1500),
          riskMode: currentRisk.current,
          parsedCount: stored.parsedActions.length,
        });

        // Auto-apply safe recommendations and create temporary adjustments
        for (const action of stored.parsedActions) {
          const a = action.action.toLowerCase();
          const target = action.target;
          const value = typeof action.value === 'number' ? action.value : 0.7; // default safe reduction

          if ((a.includes('reduce') && a.includes('risk')) || a.includes('defensive')) {
            if (systemHealth < 0.6 || currentRisk.current !== 'NORMAL') {
              const expires = 12; // ~12 runs (~2-3 hours depending on frequency)
              applyTemporaryAdjustment({
                type: 'global_risk_multiplier',
                value: Math.max(0.3, value),
                reason: `Grok auto: ${action.reason}`,
                expiresAfterRuns: expires,
                source: 'grok_auto',
              });
              console.warn(`[Runner] Auto-applied temporary risk reduction from Grok (expires in ~${expires} runs)`);
              await logAudit('grok_auto_applied', { 
                action: action.action, 
                target, 
                value: Math.max(0.3, value),
                expiresAfterRuns: expires 
              });
            }
          }

          if (a.includes('downweight') || a.includes('pause_strategy')) {
            const expires = 20;
            applyTemporaryAdjustment({
              type: 'strategy_downweight',
              target: target,
              value: a.includes('pause') ? 0.1 : Math.max(0.2, value),
              reason: `Grok auto: ${action.reason}`,
              expiresAfterRuns: expires,
              source: 'grok_auto',
            });
            console.warn(`[Runner] Auto-applied temporary strategy adjustment for ${target}`);
            await logAudit('grok_auto_applied', { action: action.action, target, expiresAfterRuns: expires });
          }
        }

        // Send high-priority recommendations via Telegram
        if (stored.parsedActions.some(a => 
            a.action.toLowerCase().includes('pause') || 
            a.action.toLowerCase().includes('emergency') ||
            a.action.toLowerCase().includes('reduce'))) {
          const summary = stored.parsedActions.map(a => 
            `- ${a.action} on ${a.target}: ${a.reason}`
          ).join('\n');
          alerts.error(`Grok Recommendation:\n${summary}`);
        }
      }
    } catch (e) {
      console.warn('[Runner] Grok Research Agent call failed (non-fatal):', e);
    }
  }

  // === Active Execution Management on Unhealthy Markets (recommendations + simulation) ===
  if (Math.random() < 0.08) {
    for (const marketId of unhealthyMarkets) {
      const action = executionManager.manageRestingOrders(marketId);
      if (action.type === 'CANCEL_ALL' || action.type === 'CANCEL_AND_REPOST') {
        console.warn(`[Runner] ACTION: ${action.type} recommended for ${marketId} — ${action.reason}`);
        
        const cancelled = executionManager.cancelOrdersForMarket(marketId);
        
        await logAudit('execution_management_action', {
          market: marketId,
          action: action.type,
          reason: action.reason,
          ordersCancelled: cancelled.length,
        });
      }
    }
  }
}

async function logAudit(action: string, payload: Record<string, unknown>) {
  try {
    await db.insert(auditEvents).values({
      actor: 'runner',
      action,
      payload,
    });
  } catch {}
}
