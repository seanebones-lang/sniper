/**
 * Cancel open orders for one Polymarket token (unlocks stuck shares).
 * Run: railway run --service sniper -- npx tsx scripts/cancel-market-orders.ts <tokenId>
 */
import {
  cancelPolymarketMarketOrders,
  getPolymarketOpenOrders,
  getPolymarketPrivateKey,
} from '../lib/clients/polymarket-trading';

async function main() {
  const tokenId = process.argv[2]?.trim();
  if (!tokenId) {
    console.error('Usage: cancel-market-orders.ts <tokenId>');
    process.exit(1);
  }

  const pk = getPolymarketPrivateKey();
  if (!pk) {
    console.error('No POLYMARKET_PRIVATE_KEY');
    process.exit(1);
  }

  const before = await getPolymarketOpenOrders(pk);
  const matching = before.filter((o) => {
    const row = o as Record<string, unknown>;
    const asset = String(row.asset_id ?? row.assetId ?? row.token_id ?? '');
    return asset === tokenId;
  });
  console.log(`Open orders for token: ${matching.length} (total open: ${before.length})`);

  const ok = await cancelPolymarketMarketOrders(pk, tokenId);
  console.log('cancelMarketOrders:', ok ? 'OK' : 'FAILED');

  const after = await getPolymarketOpenOrders(pk);
  console.log(`Open orders after: ${after.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
