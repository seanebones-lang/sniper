/**
 * One-off: create analytics indexes on the live DB without locking writes.
 * CREATE INDEX CONCURRENTLY cannot run in a transaction, so each runs standalone.
 * Idempotent via IF NOT EXISTS. Run with: railway run npx tsx scripts/add-analytics-indexes.ts
 */
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

const statements = [
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS signals_created_at_idx ON signals (created_at)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS signals_strategy_created_idx ON signals (strategy_id, created_at)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS paper_trades_filled_at_idx ON paper_trades (filled_at)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS paper_trades_signal_id_idx ON paper_trades (signal_id)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS real_trades_created_at_idx ON real_trades (created_at)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS real_trades_signal_id_idx ON real_trades (signal_id)`,
];

async function main() {
  for (const stmt of statements) {
    const started = Date.now();
    process.stdout.write(`-> ${stmt} ... `);
    try {
      await sql.unsafe(stmt);
      console.log(`ok (${Date.now() - started}ms)`);
    } catch (err) {
      console.log(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
