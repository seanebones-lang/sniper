/**
 * Alert when pending SELL orders are stale (limit exits not filling).
 */
import { db, realTrades } from '@/lib/db';
import { eq, and, lt } from 'drizzle-orm';

const STALE_SELL_MS = 30 * 60 * 1000;
let lastStaleSellAlertAt = 0;
const ALERT_INTERVAL_MS = 15 * 60 * 1000;

export async function checkStalePendingSells(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_SELL_MS);
  const stale = await db.query.realTrades.findMany({
    where: and(eq(realTrades.status, 'pending'), eq(realTrades.side, 'SELL'), lt(realTrades.createdAt, cutoff)),
    limit: 50,
  });

  if (stale.length === 0) return 0;

  const now = Date.now();
  if (now - lastStaleSellAlertAt >= ALERT_INTERVAL_MS) {
    lastStaleSellAlertAt = now;
    const summary = stale
      .slice(0, 5)
      .map(
        (t) =>
          `${t.marketExternalId.slice(0, 12)}… ${t.size}@${t.price} (${Math.round((Date.now() - t.createdAt.getTime()) / 60000)}m)`,
      )
      .join('; ');
    try {
      const { sendCriticalAlert } = await import('@/lib/alerts/critical');
      await sendCriticalAlert(
        `${stale.length} pending SELL(s) unfilled >30m — check Polymarket open orders. ${summary}`,
        { count: stale.length },
      );
    } catch {
      console.warn(`[PendingSells] ${stale.length} stale pending SELL(s)`);
    }
  }

  return stale.length;
}
