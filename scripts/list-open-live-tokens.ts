import { db } from '../lib/db';
import { getRealOpenPositionsByStrategy } from '../lib/execution/real-positions';

async function main() {
  const live = await db.query.strategies.findMany({
    where: (s, { and: a, eq: e }) => a(e(s.isActive, true), e(s.paperOnly, false)),
  });
  const m = await getRealOpenPositionsByStrategy(live.map((s) => s.id));
  for (const s of live) {
    for (const p of m.get(s.id) ?? []) {
      console.log(p.marketExternalId, 'net', p.netSize, 'entry', p.avgEntryPrice);
    }
  }
}

main();
