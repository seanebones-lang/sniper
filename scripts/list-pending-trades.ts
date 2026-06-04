/** List pending/needs_review real trades. */
import { db } from '../lib/db';

async function main() {
  const rows = await db.query.realTrades.findMany({
    where: (t, { inArray }) => inArray(t.status, ['pending', 'needs_review']),
    limit: 50,
  });
  for (const r of rows) {
    console.log(
      r.status,
      r.side,
      r.marketExternalId?.slice(0, 20),
      'size',
      r.size,
      'price',
      r.price,
      'tx',
      r.txHash?.slice(0, 24),
      'at',
      r.createdAt,
    );
  }
  console.log('total', rows.length);
}

main().catch(console.error);
