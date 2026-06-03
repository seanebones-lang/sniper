/**
 * Quick relayer auth smoke test. Usage:
 *   set -a && . ./.env.local && set +a && npx tsx scripts/test-relayer-auth.ts
 */
import { createRelayClient, executeGaslessApprovals } from '../lib/clients/polymarket-relayer';
import { getPolymarketPrivateKey } from '../lib/clients/polymarket-trading';

async function main() {
  const pk = getPolymarketPrivateKey();
  if (!pk) {
    console.error('POLYMARKET_PRIVATE_KEY missing');
    process.exit(1);
  }
  console.log('RELAYER_API_KEY set:', !!process.env.RELAYER_API_KEY);
  console.log('RELAYER_API_KEY_ADDRESS:', process.env.RELAYER_API_KEY_ADDRESS);

  const client = createRelayClient(pk);
  try {
    const txs = await client.getTransactions();
    console.log('getTransactions: ok, count=', Array.isArray(txs) ? txs.length : txs);
  } catch (e) {
    console.log('getTransactions: FAIL', e instanceof Error ? e.message.slice(0, 300) : e);
  }

  const r = await executeGaslessApprovals(pk, [
    '0xE111180000d2663C0091e4f400237545B87B996B',
  ]);
  console.log('executeGaslessApprovals:', r);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
