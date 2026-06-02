/**
 * Apply Grok recommended actions to the local DB (one-off / ops script).
 * Usage: DATABASE_URL=... npx tsx scripts/apply-grok-actions.ts
 */
import { db, strategies } from '../lib/db';
import { eq, inArray } from 'drizzle-orm';

const PAUSE_IDS = [
  '37afc0aa-6fa4-4639-9c3f-ad5e63bd75bf',
  '4491ffde-d4b6-4e77-9fb1-08ad17dbaf65',
];

const REDUCE_ID = '1c8355b6-3734-4761-8b7c-e590dfb9230b';
const REDUCE_MULTIPLIER = 0.5;

async function main() {
  for (const id of PAUSE_IDS) {
    await db.update(strategies)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(strategies.id, id));
  }

  const row = await db.query.strategies.findFirst({ where: eq(strategies.id, REDUCE_ID) });
  if (!row) {
    console.error('Strategy not found:', REDUCE_ID);
    process.exit(1);
  }

  const cfg = (row.config ?? {}) as Record<string, unknown>;
  await db.update(strategies)
    .set({
      config: { ...cfg, allocationDownweight: REDUCE_MULTIPLIER },
      updatedAt: new Date(),
    })
    .where(eq(strategies.id, REDUCE_ID));

  const updated = await db.query.strategies.findMany({
    where: inArray(strategies.id, [...PAUSE_IDS, REDUCE_ID]),
  });

  console.log('Applied Grok actions:');
  for (const s of updated) {
    const c = s.config as Record<string, unknown>;
    console.log(`  ${s.name} (${s.id.slice(-4)}): active=${s.isActive}, allocationDownweight=${c.allocationDownweight ?? 'n/a'}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
