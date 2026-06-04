/**
 * Manual ledger sync (same logic as autonomous runner heal).
 *
 * APPLY=1 railway run --service sniper -- npx tsx scripts/sync-ledger-onchain.ts
 */
import { runLiveSelfHeal } from '../lib/execution/live-self-heal';

async function main() {
  const result = await runLiveSelfHeal({ force: true, intervalMs: 0 });
  console.log(result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
