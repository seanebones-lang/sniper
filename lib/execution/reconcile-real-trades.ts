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
import { ensureMarket } from '@/lib/markets';

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
    // Reconcile both still-open orders AND anything stuck in needs_review (it may
    // now be resolvable on the exchange). Higher cap so a burst can fully drain.
    const pendingTrades = await db.query.realTrades.findMany({
      where: (t, { inArray }) => inArray(t.status, ['pending', 'needs_review']),
      limit: 200,
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

        if (trade.platform === 'polymarket') {
          try {
            const {
              getPolymarketPrivateKey,
              fetchPolymarketOrder,
              fetchPolymarketTradesForOrder,
              getPolymarketOpenOrders,
              isValidPolymarketOrderId,
            } = await import('@/lib/clients/polymarket-trading');

            const privateKey = getPolymarketPrivateKey();
            if (!privateKey) {
              continue;
            }

            if (ageMinutes > 5 && ageMinutes % 30 === 0) {
              const { getPolymarketUsdcBalance } = await import('@/lib/clients/polymarket-trading');
              const balance = await getPolymarketUsdcBalance(privateKey);
              await logAudit('polymarket_recon_balance_check', {
                tradeId: trade.id,
                balanceUsd: balance,
                ageMinutes,
              });
            }

            let orderId = isValidPolymarketOrderId(trade.txHash) ? trade.txHash! : null;

            if (!orderId) {
              const open = await getPolymarketOpenOrders(privateKey);
              const wantSide = trade.side === 'BUY' ? 'BUY' : 'SELL';
              const tradePrice = parseFloat(trade.price);
              const tradeSize = parseFloat(trade.size);
              const match = open.find((o) => {
                const row = o as Record<string, unknown>;
                const assetId = String(row.asset_id ?? '');
                const side = String(row.side ?? '').toUpperCase();
                const price = parseFloat(String(row.price ?? '0'));
                const size = parseFloat(String(row.original_size ?? row.size ?? '0'));
                return (
                  assetId === trade.marketExternalId &&
                  side === wantSide &&
                  Math.abs(price - tradePrice) < 0.02 &&
                  Math.abs(size - tradeSize) < 2
                );
              });
              if (match) {
                const row = match as Record<string, unknown>;
                orderId = String(row.id ?? row.orderID ?? '');
                if (isValidPolymarketOrderId(orderId)) {
                  await db.update(realTrades)
                    .set({ txHash: orderId })
                    .where(eq(realTrades.id, trade.id));
                }
              }
            }

            if (!orderId) {
              if (ageMinutes > 2) {
                await logAudit('polymarket_recon_no_order_id', {
                  tradeId: trade.id,
                  txHash: trade.txHash,
                  ageMinutes,
                });
              }
              if (
                ageMinutes >= 5 &&
                (!trade.txHash || trade.txHash === 'submitted')
              ) {
                await db.update(realTrades)
                  .set({ status: 'cancelled' })
                  .where(eq(realTrades.id, trade.id));
                result.updated++;
                await logAudit('polymarket_stale_pending_cancelled', {
                  tradeId: trade.id,
                  txHash: trade.txHash,
                  ageMinutes,
                });
              }
              continue;
            }

            let recon = await fetchPolymarketOrder(privateKey, orderId);

            if (!recon || recon.status === 'unknown') {
              const trades = await fetchPolymarketTradesForOrder(
                privateKey,
                orderId,
                trade.marketExternalId,
              );
              if (trades.length > 0) {
                const totalSize = trades.reduce((s, t) => s + t.size, 0);
                const avgPrice =
                  trades.reduce((s, t) => s + t.size * t.price, 0) / totalSize;
                recon = {
                  orderId,
                  status: 'filled',
                  filledSize: totalSize,
                  originalSize: parseFloat(trade.size),
                  avgPrice,
                };
              }
            }

            if (recon?.status === 'filled' && recon.filledSize > 0) {
              await recordRealFill({
                tradeId: trade.id,
                filledSize: recon.filledSize,
                filledPrice: recon.avgPrice > 0 ? recon.avgPrice : parseFloat(trade.price),
                txHash: orderId,
              });
              result.updated++;
              await logAudit('polymarket_real_fill_confirmed_via_api', {
                tradeId: trade.id,
                orderId,
                recon,
              });
              continue;
            }

            if (recon?.status === 'cancelled') {
              await db.update(realTrades)
                .set({ status: 'cancelled' })
                .where(eq(realTrades.id, trade.id));
              result.updated++;
              await logAudit('polymarket_order_cancelled_on_exchange', {
                tradeId: trade.id,
                orderId,
              });
              continue;
            }

            // Unfilled pending BUY: do not strand position-cap / exit loops on ledger-only size.
            if (trade.side === 'BUY' && ageMinutes >= 5) {
              const { getPolymarketTokenBalance, cancelPolymarketOrder } = await import(
                '@/lib/clients/polymarket-trading'
              );
              const onChain = await getPolymarketTokenBalance(privateKey, trade.marketExternalId);
              const expectedSize = parseFloat(trade.size);
              if (onChain != null && onChain < expectedSize * 0.5) {
                if (recon?.status === 'open' && orderId) {
                  await cancelPolymarketOrder(privateKey, orderId);
                }
                if (recon?.status !== 'filled') {
                  await db.update(realTrades)
                    .set({ status: 'cancelled' })
                    .where(eq(realTrades.id, trade.id));
                  result.updated++;
                  await logAudit('polymarket_stale_pending_buy_cancelled', {
                    tradeId: trade.id,
                    orderId,
                    ageMinutes,
                    onChain,
                    expectedSize,
                  });
                }
                continue;
              }
            }

            // Stale resting SELL limits block in-flight guards and fresh market exits.
            if (
              trade.side === 'SELL' &&
              recon?.status === 'open' &&
              ageMinutes >= 12 &&
              orderId
            ) {
              const { cancelPolymarketOrder } = await import('@/lib/clients/polymarket-trading');
              await cancelPolymarketOrder(privateKey, orderId);
              await db.update(realTrades)
                .set({ status: 'cancelled' })
                .where(eq(realTrades.id, trade.id));
              result.updated++;
              await logAudit('polymarket_stale_open_sell_cancelled', {
                tradeId: trade.id,
                orderId,
                ageMinutes,
              });
              continue;
            }

            // Token-balance fallback when order API is ambiguous (common on FOK/limit).
            if (!recon || recon.status === 'unknown' || recon.status === 'open') {
              const { getPolymarketTokenBalance } = await import('@/lib/clients/polymarket-trading');
              const onChain = await getPolymarketTokenBalance(privateKey, trade.marketExternalId);
              const expectedSize = parseFloat(trade.size);
              const fillPrice = parseFloat(trade.price);

              if (trade.side === 'BUY' && onChain != null && onChain >= expectedSize * 0.95) {
                await recordRealFill({
                  tradeId: trade.id,
                  filledSize: onChain,
                  filledPrice: fillPrice,
                  txHash: orderId ?? undefined,
                });
                result.updated++;
                await logAudit('polymarket_fill_confirmed_via_token_balance', {
                  tradeId: trade.id,
                  onChain,
                  expectedSize,
                });
                continue;
              }

              if (trade.side === 'SELL' && onChain != null && onChain <= 0.05) {
                await recordRealFill({
                  tradeId: trade.id,
                  filledSize: expectedSize,
                  filledPrice: fillPrice,
                  txHash: orderId ?? undefined,
                });
                result.updated++;
                await logAudit('polymarket_sell_confirmed_via_token_balance', {
                  tradeId: trade.id,
                  onChain,
                });
                continue;
              }
            }

            if (ageMinutes > 45) {
              await db.update(realTrades)
                .set({ status: 'needs_review' })
                .where(eq(realTrades.id, trade.id));
              result.updated++;
              await logAudit('polymarket_real_trade_pending_review', {
                tradeId: trade.id,
                orderId,
                ageMinutes,
              });
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

    // Auto force-exit anything still in needs_review; alert only if resolution fails.
    try {
      const { resolveNeedsReviewTrades } = await import('@/lib/monitoring/resolve-needs-review');
      await resolveNeedsReviewTrades();

      const stillStuck = await db.query.realTrades.findMany({
        where: (t, { eq }) => eq(t.status, 'needs_review'),
        columns: { id: true },
        limit: 200,
      });
      if (stillStuck.length > 0) {
        await alertNeedsReview(stillStuck.length);
      }
    } catch {
      // best effort
    }

  } catch (err) {
    result.errors++;
    console.error('[ReconcileRealTrades] Fatal error:', err);
  }

  return result;
}

/**
 * Poll the CLOB right after submit — FOK/market orders often fill before the
 * next runner cycle. Returns true when the trade row is promoted to `filled`.
 */
export async function tryImmediatePolymarketFill(tradeId: string): Promise<boolean> {
  const trade = await db.query.realTrades.findFirst({
    where: eq(realTrades.id, tradeId),
  });
  if (!trade || trade.platform !== 'polymarket' || trade.status === 'filled') {
    return false;
  }

  const {
    getPolymarketPrivateKey,
    fetchPolymarketOrder,
    fetchPolymarketTradesForOrder,
    isValidPolymarketOrderId,
  } = await import('@/lib/clients/polymarket-trading');

  const privateKey = getPolymarketPrivateKey();
  const orderId = isValidPolymarketOrderId(trade.txHash) ? trade.txHash! : null;
  if (!privateKey || !orderId) return false;

  let recon = await fetchPolymarketOrder(privateKey, orderId);

  if (!recon || recon.status === 'unknown' || (recon.status === 'open' && recon.filledSize <= 0)) {
    const fills = await fetchPolymarketTradesForOrder(
      privateKey,
      orderId,
      trade.marketExternalId,
    );
    if (fills.length > 0) {
      const totalSize = fills.reduce((s, t) => s + t.size, 0);
      const avgPrice =
        fills.reduce((s, t) => s + t.size * t.price, 0) / totalSize;
      recon = {
        orderId,
        status: 'filled',
        filledSize: totalSize,
        originalSize: parseFloat(trade.size),
        avgPrice,
      };
    }
  }

  if (recon?.status === 'filled' && recon.filledSize > 0) {
    await recordRealFill({
      tradeId: trade.id,
      filledSize: recon.filledSize,
      filledPrice: recon.avgPrice > 0 ? recon.avgPrice : parseFloat(trade.price),
      txHash: orderId,
    });
    await logAudit('polymarket_immediate_fill_confirmed', {
      tradeId: trade.id,
      orderId,
      recon,
    });
    return true;
  }

  return false;
}

/** Throttle needs_review alerts so a backlog doesn't spam Telegram every cycle. */
let lastNeedsReviewAlertAt = 0;
const NEEDS_REVIEW_ALERT_INTERVAL_MS = 15 * 60 * 1000;

async function alertNeedsReview(count: number) {
  console.warn(`[ReconcileRealTrades] ${count} real trade(s) need manual review`);
  const now = Date.now();
  if (now - lastNeedsReviewAlertAt < NEEDS_REVIEW_ALERT_INTERVAL_MS) return;
  lastNeedsReviewAlertAt = now;
  try {
    const { sendCriticalAlert } = await import('@/lib/alerts/critical');
    await sendCriticalAlert(
      `${count} real trade(s) are stuck in needs_review and could not be auto-reconciled. Manual review required.`,
      { count },
    );
  } catch {
    // alerting is best-effort
  }
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

  // Idempotency: never apply the same fill to the positions table twice. If a
  // prior reconciliation already marked this trade filled, stop — re-applying
  // the signed size would corrupt exposure and cost-basis accounting.
  if (trade.status === 'filled') {
    return;
  }

  // Accurate fee on the actually-filled notional (replaces the pre-trade estimate).
  const FEE_RATE = 0.0005;
  const filledFeeUsd = filledSize * filledPrice * FEE_RATE;

  // Update the trade record to filled (size/price reflect the REAL fill — for a
  // partial FAK fill that is the filled quantity, the remainder having cancelled).
  await db.update(realTrades)
    .set({
      status: 'filled',
      filledAt: new Date(),
      price: filledPrice.toString(),
      size: filledSize.toString(),
      fee: filledFeeUsd.toString(),
      txHash: txHash || trade.txHash || undefined,
    })
    .where(eq(realTrades.id, tradeId));

  // Defensive: ensure the market record exists before touching positions (ID discipline)
  const marketId = await ensureMarket({
    platform: trade.platform as 'polymarket' | 'kalshi',
    externalId: trade.marketExternalId,
  });

  const signedSize = trade.side === 'BUY' ? filledSize : -filledSize;

  const existing = await db.query.positions.findFirst({
    where: and(
      eq(positions.platform, trade.platform),
      eq(positions.marketId, marketId)
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
      marketId: marketId,
      side: trade.side,
      sizeShares: signedSize.toString(),
      avgPrice: filledPrice.toString(),
    });
  }

  await logAudit('real_fill_reconciled', {
    tradeId,
    marketId: marketId,
    filledSize,
    filledPrice,
    platform: trade.platform,
  });

  void import('@/lib/execution/live-round-trip-hook').then((m) =>
    m.onRealFillRecorded(tradeId).catch(() => {}),
  );
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
