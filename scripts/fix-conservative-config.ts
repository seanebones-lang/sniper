/**
 * Fix Conservative spread-scalper config for live micro trading.
 * Usage: railway run --service sniper npx tsx scripts/fix-conservative-config.ts
 */
import { db, strategies } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { normalizeStrategyConfig } from '@/lib/strategies/run-profile';

const CONSERVATIVE_ID = '253cf465-00aa-4dc1-87a5-991abdad62c4';

async function main() {
  const row = await db.query.strategies.findFirst({
    where: eq(strategies.id, CONSERVATIVE_ID),
  });
  if (!row) {
    console.error('Conservative strategy not found');
    process.exit(1);
  }

  const merged = {
    ...(row.config as Record<string, unknown>),
    minSpreadPct: 1.0,
    maxSpreadPct: 30,
    targetProfitPct: 2.5,
    stopLossPct: 8,
    maxHoldSeconds: 600,
    tradingGoal: 'spread-capture',
    tradingStyle: 'conservative',
  };
  const config = normalizeStrategyConfig(row.type, merged);

  await db
    .update(strategies)
    .set({
      config,
      maxSizeUsd: String(config.maxSizeUsd ?? 1),
      targetProfitPct: String(config.targetProfitPct ?? 2.5),
      updatedAt: new Date(),
    })
    .where(eq(strategies.id, CONSERVATIVE_ID));

  console.log(
    JSON.stringify(
      {
        ok: true,
        id: CONSERVATIVE_ID,
        minSpreadPct: config.minSpreadPct,
        maxSpreadPct: config.maxSpreadPct,
        targetProfitPct: config.targetProfitPct,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
