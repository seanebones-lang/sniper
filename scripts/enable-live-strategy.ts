/**
 * Set the active Live Quick Flip strategy to paperOnly=false (real CLOB orders).
 * Does NOT start the runner — start manually from /strategies after verifying /real status.
 */
import { db, strategies } from '../lib/db';
import { eq } from 'drizzle-orm';

async function main() {
  const active = await db.query.strategies.findMany({
    where: eq(strategies.isActive, true),
  });

  if (active.length === 0) {
    console.error('No active strategies found.');
    process.exit(1);
  }

  for (const s of active) {
    await db
      .update(strategies)
      .set({ paperOnly: false, updatedAt: new Date() })
      .where(eq(strategies.id, s.id));
    console.log(JSON.stringify({ id: s.id, name: s.name, paperOnly: false }));
  }

  console.log('Runner is stopped. Start manually from /strategies when ready.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
