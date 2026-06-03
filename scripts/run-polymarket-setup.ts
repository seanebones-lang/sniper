import {
  clearPolymarketSetupCache,
  ensurePolymarketTradingReady,
} from '../lib/clients/polymarket-trading-setup';

async function main() {
  clearPolymarketSetupCache();
  const r = await ensurePolymarketTradingReady({ force: true });
  console.log(JSON.stringify(r, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
