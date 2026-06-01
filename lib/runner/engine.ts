/**
 * Strategy Engine + Background Runner (Phase 3)
 * This is the core that makes the system "know when to buy and sell".
 */

import { db, strategies, signals, paperTrades, auditEvents } from '@/lib/db';
import { getAllMarkets } from '@/lib/markets';
import { fetchPolymarketOrderBook } from '@/lib/clients/polymarket';
import { fetchKalshiOrderBook } from '@/lib/clients/kalshi';
import { getStrategy } from '@/lib/strategies';
import { paperSimulator } from '@/lib/execution/paper-simulator';
import type { StrategyConfig, StrategySignal } from '@/lib/strategies/types';
import type { Market } from '@/lib/types';
import { alerts } from '@/lib/alerts/telegram';
import { portfolioRiskManager } from '@/lib/risk/portfolio-manager';
import { categorizeMarket } from '@/lib/risk/categorizer';
import { saveBookSnapshot } from '@/lib/data/historical';
import { getDynamicAllocations } from '@/lib/strategies/allocator';
import { extractFeaturesFromRecentSnapshots } from '@/lib/data/features';
import { executionManager } from '@/lib/execution/execution-manager';
import { edgeDecayMonitor } from '@/lib/monitoring/edge-decay';
import { riskModeManager } from '@/lib/monitoring/risk-mode';

export interface RunnerStatus {
  running: boolean;
  lastRun: string | null;
  signalsGenerated: number;
  fillsExecuted: number;
}

let status: RunnerStatus = {
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

  // === Calculate global and per-market protection factors upfront ===
  const recentQuality = executionManager.getRecentExecutionQuality(30);
  const badSlippage = recentQuality.filter(q => q.slippage > 0.006).length;
  const adverseRate = recentQuality.length > 0 ? badSlippage / recentQuality.length : 0;

  const systemHealth = executionManager.getSystemHealthScore();
  let globalRiskMultiplier = 1.0;

  // === Risk Mode Evaluation ===
  const decayingCount = activeStrategies.filter(s => edgeDecayMonitor.isDecaying(s.id).decaying).length;
  const riskModeResult = riskModeManager.evaluate(
    systemHealth,
    adverseRate,
    decayingCount,
    unhealthyMarkets.length
  );

  if (riskModeResult.changed) {
    console.warn(`[Runner] RISK MODE CHANGED → ${riskModeResult.newMode}: ${riskModeResult.reason}`);
    await logAudit('risk_mode_change', {
      newMode: riskModeResult.newMode,
      previousMode: riskModeManager.getCurrentMode().previousMode,
      reason: riskModeResult.reason,
    });
  }

  const riskMode = riskModeManager.getCurrentMode();
  globalRiskMultiplier = riskModeManager.getRiskMultiplier();

  const unhealthyMarkets = executionManager.getUnhealthyMarkets(0.45);

  if (recentQuality.length > 8 && adverseRate > 0.45) {
    console.warn(`[Runner] SELF-PROTECTION: High adverse execution rate (${(adverseRate * 100).toFixed(0)}%). Temporarily reducing risk.`);
    await logAudit('execution_quality_warning', {
      adverseRate: adverseRate.toFixed(2),
      avgSlippage: executionManager.getAverageSlippage(20),
    });
  }

  if (unhealthyMarkets.length > 0) {
    console.warn(`[Runner] Markets with poor execution health: ${unhealthyMarkets.join(', ')}`);
  }

  let signalsThisRun = 0;
  let fillsThisRun = 0;

  for (const stratRow of activeStrategies) {
    const strategyImpl = getStrategy(stratRow.type);
    if (!strategyImpl) continue;

    const config = stratRow.config as unknown as StrategyConfig;

    // Get dynamic allocations (this is the meta-layer advantage)
    const allocations = await getDynamicAllocations(activeStrategies.map(s => s.id));
    const allocation = allocations[stratRow.id] || { weight: 0.7, maxSizeMultiplier: 0.8, reason: 'Default' };

    // For MVP: evaluate on top volume markets the strategy cares about
    const relevantMarkets = markets
      .filter(m => m.status === 'open')
      .slice(0, 25); // limit for speed

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
        let currentRegime = 'normal';

        if (book && (book.bids?.length || book.asks?.length)) {
          const topBid = book.bids?.[0]?.size || 0;
          const topAsk = book.asks?.[0]?.size || 0;
          const imbalance = topBid / (topBid + topAsk + 0.0001);

          // Compute advanced features (in production we would query recent snapshots for this market)
          const advanced = extractFeaturesFromRecentSnapshots([]);

          currentRegime = advanced.regime || 'normal';

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
          } as any);
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

          const allocatorMultiplier = allocation.maxSizeMultiplier || 0.85;

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

          await db.insert(signals).values({
            strategyId: stratRow.id,
            marketId: market.id as any,
            action: signal.action as any,
            price: signal.price.toString(),
            size: finalSize.toString(),
            reason: `${signal.reason} | Risk-adjusted from ${signal.size} → ${finalSize.toFixed(0)}${sizeReason}`,
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

  // Occasional Grok Research Agent trigger (very lightweight, for continuous improvement)
  if (process.env.ENABLE_GROK_RESEARCH_AGENT === 'true' && Math.random() < 0.015) {
    try {
      const { askGrokResearchAgent } = await import('@/lib/research/grok-agent');
      const analysis = await askGrokResearchAgent({
        type: 'strategy_analysis',
        lookbackHours: 36,
      });
      await logAudit('grok_research_agent', { summary: analysis.analysis.slice(0, 800) });
      console.log('[Runner] Grok Research Agent analysis completed and logged');
    } catch (e) {
      console.warn('[Runner] Grok Research Agent call failed (non-fatal)');
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

async function logAudit(action: string, payload: any) {
  try {
    await db.insert(auditEvents).values({
      actor: 'runner',
      action,
      payload,
    });
  } catch {}
}
