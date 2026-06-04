import { db, realTrades, strategies, auditEvents } from '../lib/db';
import { desc, eq } from 'drizzle-orm';

async function main() {
  const filled = await db.query.realTrades.findMany({
    where: eq(realTrades.status, 'filled'),
    orderBy: [desc(realTrades.createdAt)],
    limit: 5,
  });
  console.log('=== LAST FILLED ===');
  for (const t of filled) {
    console.log(t.createdAt?.toISOString(), t.side, t.price, t.size, t.marketExternalId?.slice(0, 24));
  }

  const recent = await db.query.realTrades.findMany({
    orderBy: [desc(realTrades.createdAt)],
    limit: 10,
  });
  console.log('\n=== RECENT ===');
  for (const t of recent) {
    console.log(t.status, t.side, t.createdAt?.toISOString(), t.marketExternalId?.slice(0, 20));
  }

  const strats = await db.query.strategies.findMany({
    where: eq(strategies.isActive, true),
    columns: { id: true, name: true, type: true, paperOnly: true, config: true },
  });
  console.log('\n=== ACTIVE STRATEGIES ===');
  for (const s of strats) {
    console.log(JSON.stringify(s));
  }
}

main().catch(console.error);
