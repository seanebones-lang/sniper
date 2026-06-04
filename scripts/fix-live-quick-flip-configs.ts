/**
 * Fix live quick-flip rows: wrong DB `type` (e.g. orderbook-imbalance) with quick-flip config.
 * Usage: npx tsx scripts/fix-live-quick-flip-configs.ts
 */
import { db, strategies } from '../lib/db';
import { eq } from 'drizzle-orm';
import {
  normalizeStrategyConfig,
  resolveStrategyImplType,
} from '../lib/strategies/run-profile';
import type { StrategyConfig } from '../lib/strategies/types';

async function main() {
  const rows = await db.query.strategies.findMany({
    columns: { id: true, name: true, type: true, config: true, paperOnly: true, isActive: true },
  });

  let fixed = 0;
  for (const row of rows) {
    const raw = row.config as StrategyConfig;
    const implType = resolveStrategyImplType(row.type, raw);
    if (implType !== 'live-quick-flip') continue;

    const needsTypeFix = row.type !== 'live-quick-flip';
    const config = normalizeStrategyConfig('live-quick-flip', raw as unknown as Record<string, unknown>);

    if (!needsTypeFix && raw.tradingGoal === 'quick-flip') {
      console.log(`OK  ${row.name} (${row.id.slice(0, 8)}…) already live-quick-flip`);
      continue;
    }

    await db
      .update(strategies)
      .set({
        type: 'live-quick-flip',
        config,
        maxSizeUsd: String(config.maxSizeUsd ?? 1),
        targetProfitPct: String(config.targetProfitPct ?? 150),
        cooldownSeconds: Number(config.cooldownSeconds ?? 15),
        updatedAt: new Date(),
      })
      .where(eq(strategies.id, row.id));

    fixed++;
    console.log(
      JSON.stringify({
        id: row.id,
        name: row.name,
        wasType: row.type,
        nowType: 'live-quick-flip',
        active: row.isActive,
        paperOnly: row.paperOnly,
      }),
    );
  }

  console.log(fixed === 0 ? 'No strategies needed fixing.' : `Fixed ${fixed} strategy row(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
