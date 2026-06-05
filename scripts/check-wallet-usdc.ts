/**
 * On-chain USDC vs CLOB trading balance (diagnose Rabby deposit not showing).
 */
import { createPublicClient, http, formatUnits } from 'viem';
import { polygon } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import {
  getPolymarketPrivateKey,
  getPolymarketUsdcBalance,
} from '../lib/clients/polymarket-trading';
import { ensurePolymarketTradingReady } from '../lib/clients/polymarket-trading-setup';

const USDC_E = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' as const;
const USDC_NATIVE = '0x3c499c542cEF5E3811e11941ce6bd7826e6768f9' as const;
const BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

async function walletUsdc(label: string, address: string) {
  const client = createPublicClient({ chain: polygon, transport: http() });
  console.log(`\n--- ${label}`);
  console.log(`    ${address}`);
  for (const [sym, token] of [
    ['USDC.e (bridged)', USDC_E],
    ['USDC (native)', USDC_NATIVE],
  ] as const) {
    const raw = await client.readContract({
      address: token,
      abi: BALANCE_ABI,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    });
    console.log(`    ${sym}: $${formatUnits(raw, 6)}`);
  }
}

async function main() {
  const pk = getPolymarketPrivateKey();
  if (!pk) {
    console.error('POLYMARKET_PRIVATE_KEY not set');
    process.exit(1);
  }

  const eoa = privateKeyToAccount(pk as `0x${string}`).address;
  const funder = process.env.POLYMARKET_FUNDER_ADDRESS?.trim();

  console.log('Polymarket trading uses a separate deposit wallet from your Rabby EOA.');
  await walletUsdc('EOA (Rabby / signer key)', eoa);
  if (funder?.startsWith('0x')) {
    await walletUsdc('POLYMARKET_FUNDER (CLOB deposit wallet)', funder);
  }

  const setup = await ensurePolymarketTradingReady({ force: true });
  const clob = await getPolymarketUsdcBalance(pk, { syncFirst: true });
  console.log('\n--- CLOB trading balance (what the bot uses)');
  console.log(`    $${clob?.toFixed(4) ?? 'null'} (sigType ${setup.signatureType})`);
  console.log(`    ready: ${setup.ready}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
