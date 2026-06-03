#!/usr/bin/env npx tsx
/**
 * One-time Railway DB bootstrap: schema is via db:push; this seeds the live quick-flip strategy.
 */
import { db, strategies } from '../lib/db';
import { eq } from 'drizzle-orm';

const LIVE_QUICK_FLIP_ID = '12d5c973-71ce-46aa-8aee-2c52633fce6c';

async function main() {
  const config = {
    tradingStyle: 'aggressive',
    tradingGoal: 'quick-flip',
    liveMarketsOnly: true,
    platforms: ['polymarket'],
  };

  const existing = await db.query.strategies.findFirst({
    where: eq(strategies.id, LIVE_QUICK_FLIP_ID),
  });

  if (existing) {
    await db
      .update(strategies)
      .set({
        isActive: true,
        paperOnly: false,
        maxSizeUsd: '1',
        config,
        updatedAt: new Date(),
      })
      .where(eq(strategies.id, LIVE_QUICK_FLIP_ID));
    console.log('Updated Live Quick Flip strategy (live, active)');
  } else {
    await db.insert(strategies).values({
      id: LIVE_QUICK_FLIP_ID,
      name: 'Live Quick Flip',
      type: 'live-quick-flip',
      config,
      isActive: true,
      paperOnly: false,
      maxSizeUsd: '1',
      targetProfitPct: '150',
      cooldownSeconds: 15,
    });
    console.log('Created Live Quick Flip strategy (live, active)');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
