import { desc } from 'drizzle-orm';
import { db, auditEvents, realTrades } from '../lib/db';

async function main() {
  const recent = await db.query.realTrades.findMany({
    orderBy: [desc(realTrades.createdAt)],
    limit: 15,
    columns: {
      id: true,
      side: true,
      status: true,
      price: true,
      size: true,
      txHash: true,
      createdAt: true,
    },
  });
  console.log('Recent real_trades:');
  for (const t of recent) {
    console.log(
      `  ${t.createdAt.toISOString().slice(11, 19)} ${t.status.padEnd(10)} ${t.side} $${t.price} x${t.size} tx=${(t.txHash ?? '').slice(0, 24)}`,
    );
  }

  const audits = await db.query.auditEvents.findMany({
    where: (a, { like }) => like(a.action, 'real_%'),
    orderBy: [desc(auditEvents.createdAt)],
    limit: 20,
    columns: { action: true, payload: true, createdAt: true },
  });
  console.log('\nRecent real_* audits:');
  for (const a of audits) {
    const p = (a.payload ?? {}) as Record<string, unknown>;
    const err = p.error ?? p.errorMsg ?? p.reason;
    const ok = p.success;
    console.log(
      `  ${a.createdAt.toISOString().slice(11, 19)} ${a.action}`,
      ok !== undefined ? `success=${ok}` : '',
      err ? String(err).slice(0, 80) : '',
    );
  }

  const blocked = await db.query.auditEvents.findMany({
    orderBy: [desc(auditEvents.createdAt)],
    limit: 50,
    columns: { action: true, payload: true, createdAt: true },
  });
  const blocks = blocked.filter((a) => a.action.includes('blocked') || a.action === 'execution_manager_decision');
  console.log('\nRecent blocks / exec decisions:', blocks.length);
  for (const a of blocks.slice(0, 10)) {
    const p = (a.payload ?? {}) as Record<string, unknown>;
    const dec = p.decision as { type?: string; reason?: string } | undefined;
    console.log(
      `  ${a.action}`,
      dec?.type ?? '',
      dec?.reason ?? p.reason ?? p.error ?? '',
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
