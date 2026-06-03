/**
 * Quick live Polymarket diagnostics (reads .env.local via Next / shell).
 * Usage: set -a && . ./.env.local && set +a && npx tsx scripts/check-polymarket-live.ts
 */
import { AssetType, ClobClient } from '@polymarket/clob-client-v2';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';
import {
  ensurePolymarketApiCreds,
  getPolymarketPrivateKey,
  getPolymarketOpenOrders,
  getPolymarketUsdcBalance,
} from '../lib/clients/polymarket-trading';
import { getRelayerCredentials } from '../lib/clients/polymarket-relayer';
import { ensurePolymarketTradingReady } from '../lib/clients/polymarket-trading-setup';
import { db, realTrades } from '../lib/db';
import { eq, sql } from 'drizzle-orm';

async function main() {
  const pk = getPolymarketPrivateKey();
  if (!pk) {
    console.log('POLYMARKET_PRIVATE_KEY not set');
    process.exit(1);
  }

  console.log('Relayer creds mode:', getRelayerCredentials().mode);
  const setup = await ensurePolymarketTradingReady({ force: true });
  console.log('Auto-setup:', setup);

  const balance = await getPolymarketUsdcBalance(pk, { syncFirst: true });
  const open = await getPolymarketOpenOrders(pk);
  console.log('CLOB collateral balance (USD):', balance);
  console.log('POLYMARKET_FUNDER_ADDRESS:', process.env.POLYMARKET_FUNDER_ADDRESS?.slice(0, 10) + '…');
  console.log('POLYMARKET_SIGNATURE_TYPE:', process.env.POLYMARKET_SIGNATURE_TYPE ?? '0');
  console.log('Open orders on CLOB:', open.length);

  const funder = process.env.POLYMARKET_FUNDER_ADDRESS?.trim();
  const account = privateKeyToAccount(pk as `0x${string}`);
  const wallet = createWalletClient({ account, chain: polygon, transport: http() });
  console.log('EOA (signer):', account.address);

  for (const sigType of [0, 1, 2] as const) {
    const client = new ClobClient({
      host: 'https://clob.polymarket.com',
      chain: 137,
      signer: wallet as never,
      signatureType: sigType,
      funderAddress:
        sigType === 0 || !funder?.startsWith('0x')
          ? undefined
          : (funder as `0x${string}`),
      useServerTime: true,
    });
    await ensurePolymarketApiCreds(client);
    await client.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    const bal = await client.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    console.log(`balance sigType=${sigType}:`, bal);
  }
  if (open[0]) {
    const row = open[0] as Record<string, unknown>;
    console.log('Sample order:', {
      id: row.id,
      asset_id: String(row.asset_id ?? '').slice(0, 24) + '…',
      side: row.side,
      price: row.price,
      original_size: row.original_size,
      size_matched: row.size_matched,
      status: row.status,
    });
  }

  const byStatus = await db
    .select({ status: realTrades.status, cnt: sql<number>`count(*)::int` })
    .from(realTrades)
    .groupBy(realTrades.status);
  console.log('DB real_trades by status:', byStatus);

  const badTx = await db.query.realTrades.findMany({
    where: eq(realTrades.status, 'pending'),
    limit: 3,
    columns: { txHash: true, price: true, size: true, createdAt: true },
  });
  console.log('Sample pending txHash:', badTx.map((t) => t.txHash));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
