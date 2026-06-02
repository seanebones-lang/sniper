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
        if (trade.platform === 'kalshi') {
          // Kalshi-specific reconciliation — exercises authenticated trading client
          try {
            const { getKalshiTradingClient } = await import('@/lib/clients/kalshi-trading');
            const client = getKalshiTradingClient();

            const ageMs = Date.now() - new Date(trade.createdAt).getTime();
            const ageMinutes = Math.round(ageMs / 60000);

            // Periodically ping balance during recon (proves auth + connectivity)
            if (ageMinutes > 5 || (ageMinutes > 0 && ageMinutes % 30 === 0)) {
              try {
                const bal = await client.getBalance();
                await logAudit('kalshi_recon_balance_check', {
                  tradeId: trade.id,
                  balance: bal,
                  ageMinutes,
                });
              } catch (balErr) {
                await logAudit('kalshi_recon_balance_failed', {
                  tradeId: trade.id,
                  error: balErr instanceof Error ? balErr.message : String(balErr),
                });
              }
            }

            // === Real order status polling for Kalshi (major step toward prod-gap-2) ===
            try {
              const orderId = trade.txHash;

              // Try direct order lookup first (most precise)
              if (orderId) {
                const orderStatus = await client.getOrderStatus(orderId);
                const raw = (orderStatus as any).raw || orderStatus;

                const isFilled = orderStatus.filled || raw?.status === 'filled' || (raw?.filled_count ?? 0) > 0;
                const filledCount = raw?.filled_count ?? (isFilled ? parseFloat(trade.size) : 0);

                if (isFilled && filledCount > 0) {
                  await recordRealFill({
                    tradeId: trade.id,
                    filledSize: filledCount,
                    filledPrice: parseFloat(raw?.avg_price || trade.price),
                    txHash: orderId,
                  });
                  result.updated++;
                  await logAudit('kalshi_real_fill_confirmed_via_api', {
                    tradeId: trade.id,
                    orderId,
                    filledSize: filledCount,
                  });
                  continue;
                }

                if (raw?.status === 'cancelled' || raw?.status === 'expired') {
                  await db.update(realTrades)
                    .set({ status: 'cancelled' })
                    .where(eq(realTrades.id, trade.id));
                  result.updated++;
                  await logAudit('kalshi_order_cancelled_on_exchange', { tradeId: trade.id, orderId });
                  continue;
                }
              }

              // Secondary: check recent fills list for this market (catches fills without direct order id)
              try {
                const fills = await client.getFills({ ticker: trade.marketExternalId, limit: 20 });
                const matchingFill = fills?.fills?.find((f: any) => f.order_id === orderId || f.ticker === trade.marketExternalId);
                if (matchingFill && matchingFill.filled_count > 0) {
                  await recordRealFill({
                    tradeId: trade.id,
                    filledSize: matchingFill.filled_count,
                    filledPrice: matchingFill.avg_price || parseFloat(trade.price),
                    txHash: matchingFill.order_id,
                  });
                  result.updated++;
                  await logAudit('kalshi_real_fill_confirmed_via_fills_api', {
                    tradeId: trade.id,
                    orderId,
                    fill: matchingFill,
                  });
                  continue;
                }
              } catch {}
            } catch (orderErr) {
              await logAudit('kalshi_order_status_poll_failed', {
                tradeId: trade.id,
                error: orderErr instanceof Error ? orderErr.message : String(orderErr),
              });
            }

            if (ageMinutes > 10) {
              await logAudit('kalshi_real_trade_pending_review', {
                tradeId: trade.id,
                marketExternalId: trade.marketExternalId,
                ageMinutes,
                note: 'Trade has been pending for a long time - manual review recommended',
              });
            }

            // Very old trades that still have no confirmation → needs_review
            if (ageMinutes > 45) {
              await db.update(realTrades)
                .set({ status: 'needs_review' })
                .where(eq(realTrades.id, trade.id));
              result.updated++;
            }
          } catch (kalshiReconErr) {
            result.errors++;
            await logAudit('kalshi_reconciliation_error', {
              tradeId: trade.id,
              error: kalshiReconErr instanceof Error ? kalshiReconErr.message : String(kalshiReconErr),
            });
          }
          continue;
        }

        // === Polymarket reconciliation logic (advancing symmetry with Kalshi) ===
        const ageMs = Date.now() - new Date(trade.createdAt).getTime();
        const ageMinutes = Math.round(ageMs / 60000);

        if (trade.platform === 'polymarket' && trade.txHash) {
          try {
            const { getPolymarketOpenOrders } = await import('@/lib/clients/polymarket');
            // Note: This requires POLYMARKET_PRIVATE_KEY to be set for real reconciliation
            const privateKey = process.env.POLYMARKET_PRIVATE_KEY;
            if (privateKey) {
              const openOrders = await getPolymarketOpenOrders(privateKey);
              const stillOpen = Array.isArray(openOrders) && openOrders.some((o: any) => o.orderID === trade.txHash);

              if (!stillOpen && ageMinutes > 5) {
                // Order no longer open → likely filled or cancelled. Mark for review / heuristic close
                await db.update(realTrades)
                  .set({ status: ageMinutes > 30 ? 'needs_review' : 'pending' })
                  .where(eq(realTrades.id, trade.id));

                await logAudit('polymarket_order_no_longer_open', {
                  tradeId: trade.id,
                  orderId: trade.txHash,
                  ageMinutes,
                });

                result.updated++;
              }
            }
          } catch (polyErr) {
            await logAudit('polymarket_recon_error', {
              tradeId: trade.id,
              error: polyErr instanceof Error ? polyErr.message : String(polyErr),
            });
          }
        }

        if (ageMinutes > 15) {
          await logAudit('real_trade_stuck', {
            tradeId: trade.id,
            platform: trade.platform,
            marketExternalId: trade.marketExternalId,
            ageMinutes,
          });
        }

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

  const trade = await db.query.realTrades.findFirst({
    where: eq(realTrades.id, tradeId),
  });
  if (!trade) return;

  // Update the trade record to filled
  await db.update(realTrades)
    .set({
      status: 'filled',
      filledAt: new Date(),
      price: filledPrice.toString(),
      size: filledSize.toString(),
      txHash: txHash || trade.txHash || undefined,
    })
    .where(eq(realTrades.id, tradeId));

  const market = await db.query.markets.findFirst({
    where: and(
      eq(markets.platform, trade.platform),
      eq(markets.externalId, trade.marketExternalId)
    ),
  });
  if (!market) return;

  const signedSize = trade.side === 'BUY' ? filledSize : -filledSize;

  const existing = await db.query.positions.findFirst({
    where: and(
      eq(positions.platform, trade.platform),
      eq(positions.marketId, market.id)
    ),
  });

  if (existing) {
    const prevSize = parseFloat(existing.sizeShares) || 0;
    const prevAvg = parseFloat(existing.avgPrice) || 0;
    const newSize = prevSize + signedSize;
    const totalCost = prevSize * prevAvg + signedSize * filledPrice;
    const newAvg = newSize !== 0 ? totalCost / newSize : filledPrice;

    await db.update(positions)
      .set({
        sizeShares: newSize.toString(),
        avgPrice: newAvg.toString(),
        updatedAt: new Date(),
      })
      .where(eq(positions.id, existing.id));
  } else {
    await db.insert(positions).values({
      platform: trade.platform,
      marketId: market.id,
      side: trade.side,
      sizeShares: signedSize.toString(),
      avgPrice: filledPrice.toString(),
    });
  }

  await logAudit('real_fill_reconciled', {
    tradeId,
    marketId: market.id,
    filledSize,
    filledPrice,
    platform: trade.platform,
  });
}

// Simple audit helper (can be centralized later)
async function logAudit(action: string, payload: Record<string, unknown>) {
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
