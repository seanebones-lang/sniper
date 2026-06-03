/**
 * End-to-end gate check for live Polymarket trading.
 * Usage: npx tsx scripts/verify-live-trading.ts
 */
import { db, strategies } from '../lib/db';
import { eq } from 'drizzle-orm';
import { isRealExecutionAllowed, getRealExecutionStatus } from '../lib/execution/real-executor';
import { getPolymarketPrivateKey, getPolymarketUsdcBalance } from '../lib/clients/polymarket-trading';
import { ensurePolymarketTradingReady } from '../lib/clients/polymarket-trading-setup';
import { checkPolymarketGeoblock } from '../lib/clients/polymarket-geoblock';
import { getPaperBudgetSettings } from '../lib/settings/paper-budget';

async function main() {
  const failures: string[] = [];

  console.log('=== Live trading verification ===\n');

  if (process.env.SNIPER_ENABLE_REAL_EXECUTION !== 'true') {
    failures.push('SNIPER_ENABLE_REAL_EXECUTION is not true');
  } else {
    console.log('OK  SNIPER_ENABLE_REAL_EXECUTION=true');
  }

  const allowed = await isRealExecutionAllowed();
  if (!allowed) failures.push('isRealExecutionAllowed() returned false');
  else console.log('OK  Kill switch / durable disable clear');

  const status = await getRealExecutionStatus();
  if (status.blockers.length > 0) {
    failures.push(...status.blockers.map((b) => `blocker: ${b}`));
  } else {
    console.log('OK  No real execution blockers');
  }

  const geo = await checkPolymarketGeoblock({ ignoreSkip: true });
  if (geo.blocked) {
    failures.push(`geoblock: ${geo.country} ${geo.ip ?? ''}`);
  } else {
    console.log(`OK  Geoblock clear (${geo.country ?? 'unknown'})`);
  }

  const pk = getPolymarketPrivateKey();
  if (!pk) failures.push('POLYMARKET_PRIVATE_KEY missing');
  else console.log('OK  Private key present');

  if (pk) {
    const setup = await ensurePolymarketTradingReady();
    if (!setup.ready) failures.push(setup.message ?? 'Polymarket trading not ready');
    else console.log(`OK  Trading ready, balance $${setup.balanceUsd?.toFixed(2)}`);

    const bal = await getPolymarketUsdcBalance(pk, { syncFirst: true });
    console.log(`    CLOB balance: $${bal?.toFixed(2) ?? '?'}`);
    if (bal != null && bal < 0.5) failures.push(`Balance too low: $${bal}`);
  }

  const active = await db.query.strategies.findMany({
    where: eq(strategies.isActive, true),
    columns: { name: true, paperOnly: true, type: true },
  });
  const liveStrats = active.filter((s) => !s.paperOnly);
  if (liveStrats.length === 0) {
    failures.push('No active strategy with paperOnly=false');
  } else {
    console.log(`OK  Live-capable strategies: ${liveStrats.map((s) => s.name).join(', ')}`);
  }

  const budget = await getPaperBudgetSettings();
  console.log(`    Paper budget (sim only): $${budget.paperBudgetUsd}`);

  if (!process.env.POLYMARKET_HTTP_PROXY?.trim()) {
    console.warn('WARN  POLYMARKET_HTTP_PROXY not set — CLOB orders may 403 outside allowed regions');
  } else {
    console.log('OK  HTTP proxy configured for CLOB');
  }

  console.log('\n=== Result ===');
  if (failures.length === 0) {
    console.log('PASS — runner can place real orders when signals fire.');
    process.exit(0);
  }
  for (const f of failures) console.error('FAIL', f);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
