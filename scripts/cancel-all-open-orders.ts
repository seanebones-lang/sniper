/**
 * Cancel ALL open Polymarket orders (cancelAll API — catches ghost locks).
 * Run: railway run --service sniper -- npx tsx scripts/cancel-all-open-orders.ts
 */
import {
  getPolymarketPrivateKey,
  getPolymarketOpenOrders,
  cancelAllPolymarketOrders,
  cancelPolymarketOrder,
  isValidPolymarketOrderId,
} from '../lib/clients/polymarket-trading';

async function main() {
  const pk = getPolymarketPrivateKey();
  if (!pk) {
    console.error('No POLYMARKET_PRIVATE_KEY');
    process.exit(1);
  }

  const before = await getPolymarketOpenOrders(pk);
  console.log(`Open orders (getOpenOrders): ${before.length}`);
  for (const o of before) {
    const row = o as Record<string, unknown>;
    console.log(JSON.stringify(row).slice(0, 200));
  }

  const ok = await cancelAllPolymarketOrders(pk);
  console.log('cancelAll:', ok ? 'OK' : 'FAILED');

  const after = await getPolymarketOpenOrders(pk);
  console.log(`Open orders after cancelAll: ${after.length}`);

  for (const o of after) {
    const row = o as Record<string, unknown>;
    const orderId = String(row.id ?? row.orderID ?? '');
    if (isValidPolymarketOrderId(orderId)) {
      await cancelPolymarketOrder(pk, orderId);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
