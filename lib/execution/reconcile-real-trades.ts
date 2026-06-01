/**
 * Real Trade Reconciliation
 * 
 * This module is responsible for closing the loop between "we submitted an order"
 * and "what actually happened on the exchange".
 * 
 * Currently basic — can be extended with Polymarket order status polling,
 * WebSocket fill events, or periodic on-chain checks.
 */

import { db, realTrades, positions, markets, auditEvents } from '@/lib/db';
import { eq, and } from 'drizzle-orm';

export interface ReconciliationResult {
  checked: number;
  updated: number;
  errors: number;
}

/**
 * Reconcile pending real trades.
 * This should be called periodically (e.g. from the runner or a dedicated job).
 */
export async function reconcilePendingRealTrades(): Promise<ReconciliationResult> {
  const result: ReconciliationResult = { checked: 0, updated: 0, errors: 0 };

  try {
    const pendingTrades = await db.query.realTrades.findMany({
      where: (t, { eq }) => eq(t.status, 'pending'),
      limit: 50,
    });

    result.checked = pendingTrades.length;

    for (const trade of pendingTrades) {
      try {
        // === Placeholder reconciliation logic ===
        // In a production system you would:
        // 1. Use the txHash / orderId to query Polymarket CLOB or on-chain events
        // 2. Or listen to WebSocket fill events
        // 3. Update size filled, price, status, filledAt

        // For now we implement a very conservative "time-based" heuristic + audit
        const ageMs = Date.now() - new Date(trade.createdAt).getTime();

        if (ageMs > 1000 * 60 * 15) { // 15 minutes old pending trade
          // Mark as potentially stuck for manual review
          await db.update(realTrades)
            .set({ 
              status: 'pending', // keep as pending but we could add a 'stuck' status
            })
            .where(eq(realTrades.id, trade.id));

          await logAudit('real_trade_stuck', {
            tradeId: trade.id,
            platform: trade.platform,
            marketExternalId: trade.marketExternalId,
            ageMinutes: Math.round(ageMs / 60000),
          });
        }

        // Future: actual fill detection would go here
        // Example skeleton:
        // const fillData = await fetchPolymarketOrderStatus(trade.txHash);
        // if (fillData.filled) {
        //   await updateTradeAndPosition(trade, fillData);
        //   result.updated++;
        // }

      } catch (err) {
        result.errors++;
        await logAudit('real_reconciliation_error', {
          tradeId: trade.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (result.updated > 0) {
      await logAudit('real_reconciliation_batch', {
        checked: result.checked,
        updated: result.updated,
        errors: result.errors,
      });
    }

  } catch (err) {
    result.errors++;
    console.error('[ReconcileRealTrades] Fatal error:', err);
  }

  return result;
}

/**
 * Helper to update both the trade and the positions table after a real fill.
 * This is the missing piece for proper portfolio tracking on real money.
 */
export async function recordRealFill(params: {
  tradeId: string;
  filledSize: number;
  filledPrice: number;
  txHash?: string;
}) {
  const { tradeId, filledSize, filledPrice, txHash } = params;

  // Update the trade record
  await db.update(realTrades)
    .set({
      status: 'filled',
      filledAt: new Date(),
      price: filledPrice.toString(),
      size: filledSize.toString(),
      txHash: txHash || undefined,
    })
    .where(eq(realTrades.id, tradeId));

  // Find the internal market ID
  const trade = await db.query.realTrades.findFirst({
    where: eq(realTrades.id, tradeId),
  });

  if (!trade) return;

  const market = await db.query.markets.findFirst({
    where: and(
      eq(markets.platform, trade.platform),
      eq(markets.externalId, trade.marketExternalId)
    ),
  });

  if (!market) return;

  // Upsert into positions (basic version)
  const existing = await db.query.positions.findFirst({
    where: and(
      eq(positions.platform, trade.platform),
      eq(positions.marketId, market.id)
    ),
  });

  if (existing) {
    // Very simplified averaging (production should be more careful)
    const totalSize = parseFloat(existing.sizeShares) + (trade.side === 'BUY' ? filledSize : -filledSize);
    await db.update(positions)
      .set({
        sizeShares: totalSize.toString(),
        updatedAt: new Date(),
      })
      .where(eq(positions.id, existing.id));
  } else {
    await db.insert(positions).values({
      platform: trade.platform,
      marketId: market.id,
      side: trade.side,
      sizeShares: (trade.side === 'BUY' ? filledSize : -filledSize).toString(),
      avgPrice: filledPrice.toString(),
    });
  }

  await logAudit('real_fill_reconciled', {
    tradeId,
    marketId: market.id,
    filledSize,
    filledPrice,
  });
}

// Simple audit helper (can be centralized later)
async function logAudit(action: string, payload: any) {
  try {
    await db.insert(auditEvents).values({
      actor: 'reconciliation',
      action,
      payload,
    });
  } catch {
    // best effort - never let auditing break reconciliation
  }
}
