/**
 * Strategy Engine + Background Runner (Phase 3)
 * This is the core that makes the system "know when to buy and sell".
 */

import { db, strategies, signals, paperTrades } from '@/lib/db';
import { getAllMarkets } from '@/lib/markets';
import { fetchPolymarketOrderBook } from '@/lib/clients/polymarket';
import { fetchKalshiOrderBook } from '@/lib/clients/kalshi';
import { getStrategy } from '@/lib/strategies';
import { paperSimulator } from '@/lib/execution/paper-simulator';
import type { StrategyConfig, StrategySignal } from '@/lib/strategies/types';
import type { Market } from '@/lib/types';
import { alerts } from '@/lib/alerts/telegram';

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

  let signalsThisRun = 0;
  let fillsThisRun = 0;

  for (const stratRow of activeStrategies) {
    const strategyImpl = getStrategy(stratRow.type);
    if (!strategyImpl) continue;

    const config = stratRow.config as unknown as StrategyConfig;

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

        const signal = strategyImpl.evaluate(
          { market, book, currentPrice },
          config
        );

        if (signal && signal.action !== 'HOLD') {
          signalsThisRun++;

          // Persist signal
          await db.insert(signals).values({
            strategyId: stratRow.id,
            marketId: market.id as any, // note: in real we'd resolve market id properly
            action: signal.action as any,
            price: signal.price.toString(),
            size: signal.size.toString(),
            reason: signal.reason,
          });

          const isRealAllowed = process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true' && !stratRow.paperOnly;

          if (isRealAllowed) {
            // Real execution path (Phase 4+)
            const { placeRealOrder } = await import('@/lib/execution/real-executor');
            const result = await placeRealOrder({
              market,
              side: signal.action as 'BUY' | 'SELL',
              price: signal.price,
              size: signal.size,
              reason: `[REAL][${stratRow.name}] ${signal.reason}`,
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
              size: signal.size,
              reason: `[${stratRow.name}] ${signal.reason}`,
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
}
