import { db, realTrades } from '../lib/db';
import { desc } from 'drizzle-orm';
import { getRealOpenPositionsByStrategy } from '../lib/execution/real-positions';

async function main() {
  const rows = await db.query.realTrades.findMany({
    orderBy: [desc(realTrades.createdAt)],
    limit: 40,
  });

  const byStatus: Record<string, number> = {};
  const bySide: Record<string, number> = {};
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    bySide[`${r.side}:${r.status}`] = (bySide[`${r.side}:${r.status}`] ?? 0) + 1;
  }

  console.log('Trade counts:', { byStatus, bySide, total: rows.length });
  console.log('\nRecent:');
  for (const r of rows.slice(0, 20)) {
    console.log(
      `${r.createdAt.toISOString().slice(11, 19)} ${r.side.padEnd(4)} ${r.status.padEnd(12)} size=${r.size} @${r.price} mkt=${r.marketExternalId.slice(0, 14)}… fill=${r.filledAt?.toISOString() ?? '—'}`,
    );
  }

  const strategyId = '8cb568b7-1901-4fc5-8c35-db4cfc7557b0';
  const pos = await getRealOpenPositionsByStrategy([strategyId]);
  const open = pos.get(strategyId) ?? [];
  console.log(`\nOpen positions (filled only): ${open.length}`);
  for (const p of open) {
    console.log(
      `  ${p.marketExternalId.slice(0, 14)}… net=${p.netSize} entry=${p.avgEntryPrice.toFixed(4)} opened=${p.openedAt.toISOString()}`,
    );
  }
}

main().catch(console.error);
