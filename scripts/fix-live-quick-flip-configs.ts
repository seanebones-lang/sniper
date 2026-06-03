/**
 * Normalize all live-quick-flip strategy rows in the DB (fixes mis-set tradingGoal/style).
 * Usage: npx tsx scripts/fix-live-quick-flip-configs.ts
 */
import { db, strategies } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { normalizeStrategyConfig } from '@/lib/strategies/run-profile';

async function main() {
  const rows = await db.query.strategies.findMany({
    where: eq(strategies.type, 'live-quick-flip'),
    columns: { id: true, name: true, config: true },
  });

  if (rows.length === 0) {
    console.log('No live-quick-flip strategies found.');
    return;
  }

  for (const row of rows) {
    const before = row.config as Record<string, unknown>;
    const config = normalizeStrategyConfig('live-quick-flip', before);
    await db
      .update(strategies)
      .set({
        config,
        maxSizeUsd: String(config.maxSizeUsd ?? 1),
        targetProfitPct: String(config.targetProfitPct ?? 150),
        cooldownSeconds: Number(config.cooldownSeconds ?? 15),
        updatedAt: new Date(),
      })
      .where(eq(strategies.id, row.id));

    console.log(
      JSON.stringify({
        id: row.id,
        name: row.name,
        before: { tradingGoal: before.tradingGoal, tradingStyle: before.tradingStyle },
        after: { tradingGoal: config.tradingGoal, tradingStyle: config.tradingStyle },
      }),
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
