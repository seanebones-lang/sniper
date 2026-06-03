# Real Execution Runbook

> **Last updated:** June 3, 2026 (real-position exit lifecycle, single-runner lock, durable state restore, reconciliation/exposure hardening).

## Overview

How to safely operate real-money execution on Sniper. As of the June 3, 2026 safety pass the real path has a working **exit lifecycle** (real BUYs are no longer trapped), a **single-runner lock**, **durable safety-state restore**, and hardened **reconciliation + exposure** tracking.

**Current posture:** all strategies are `paperOnly: true`. Do **not** re-arm live until the [soak gate](#soak-gate-before-scaling-capital) passes.

## How real orders flow

1. Runner evaluates markets. For a `paperOnly:false` strategy it reads **real** open positions (`getRealOpenPositionsByStrategy`) into `openByMarket`.
2. Exit engine runs first on open positions → emits SELL (take-profit / stop / max-hold). Otherwise the strategy may emit a BUY.
3. `placeRealOrder` runs every gate (below), inserts a `pending` `real_trades` row with `signalId`, and submits:
   - **Entry (take-liquidity):** Polymarket market **FOK**, `amount` = USD.
   - **Entry (passive):** limit (post-only when ExecutionManager says so).
   - **Exit:** forced `TAKE_AGGRESSIVE` → market **FAK**, `amount` = shares. Exits always cross; a missing book cannot strand a position.
4. `reconcilePendingRealTrades()` (each cycle) polls order/fill status and calls `recordRealFill` → updates `positions`, marks the trade `filled`. The next cycle then sees the open/closed position correctly.

## Gates (all must pass for a real order)

- `SNIPER_ENABLE_REAL_EXECUTION=true` **and** `SNIPER_DISABLE_REAL_EXECUTION` not set.
- Durable kill switch not engaged (`system_state.kill_switch`).
- Strategy `paperOnly: false`.
- **Single-runner lock** held by this instance.
- Polymarket geoblock clear + trading ready (balance/approvals) for entries.
- **Idempotency:** no existing `pending/filled/needs_review` `real_trades` row for the same `signalId`.
- **In-flight guard:** no `pending` real order already on this market.
- **Cash guard:** estimated USD ≤ live spendable balance (BUYs only).
- Sync risk gate (`riskEngine.checkRisk`: per-trade size + daily-loss breaker).
- Async real-exposure gate (`riskEngine.checkRealExposure`: total + per-market USD caps) — **entries only; exits exempt**.
- Portfolio sizing (`calculateSafeSize`) allows the size — **exits liquidate the full position, never re-capped**.
- ExecutionManager does not say WAIT/CANCEL (overridden to TAKE_AGGRESSIVE for exits).

## Emergency kill switch

- **Hard stop (deployment):** set `SNIPER_DISABLE_REAL_EXECUTION=true` — highest priority, checked first in `isRealExecutionAllowed`.
- **Runtime:** `disableRealExecution(reason)` — durable (persisted to `system_state`) and now sends a **critical Telegram alert**.
- Recovered on startup; runner logs loudly if it was previously disabled.
- Re-enable: clear the env var (and/or `enableRealExecution()`), then restart.

## Single-runner lock

- A `system_state` lease (`runner_lock`) + heartbeat ensures only one loop trades the DB.
- **Fails closed** when real execution is enabled (refuses to start a second loop); fails open for paper.
- Refreshed every cycle; if the lease is lost to another instance the loop stops itself.
- Safe across Railway rolling deploys and accidental replica scaling.

## Durable safety-state restore (on startup)

Restored (not just logged) from `system_state`:

- **Kill switch** — respected immediately.
- **Risk mode** — re-applied; escalates to **at least DEFENSIVE** if the last execution-health summary was poor.
- **Daily-loss** tracking — breaker survives a redeploy.
- **Drawdown high-water mark** — breaker is recoverable, not reset by the deploy.

## Reconciliation & accounting

- Polls both `pending` **and** `needs_review` (cap 200/cycle) so a backlog can drain.
- `recordRealFill` is **idempotent** (won't double-apply a fill to `positions`) and records an **accurate fee** on the filled notional. Partial FAK fills record the actually-filled quantity.
- Any trades stuck in `needs_review` raise a **throttled critical alert** (every ≤15 min).
- **Pending SELL monitor:** alerts when limit exits unfilled >30m (`checkStalePendingSells`).
- **Runner stall alert:** no cycle within 2.5× interval while `running=true`.
- `positions` + durable risk snapshots are the source of truth for exposure after reconciliation.
- Watch audit events: `real_fill_reconciled`, `polymarket_real_fill_confirmed_via_api`, `kalshi_real_fill_confirmed_via_api`, `real_order_skipped_duplicate_signal`, `runner_real_skipped_in_flight`, `real_order_blocked_real_exposure`.

## Monitoring & alerts

Telegram alerts fire for: real order submitted (entry + exit), `needs_review` backlog, kill-switch engaged, stale pending SELLs, runner stall, and durable-state **persist failures**. Also check `/real`, `/api/real/ops`, `/api/health/ready`, and runner status.

## Soak gate (before scaling capital)

Do **not** scale capital on an unproven edge — that is the real risk. Gate order:

1. **Prove edge in paper.** Run an extended paper soak; confirm the strategy is net-positive **after fees + slippage** (`scripts/diagnose-paper-pnl.ts`, dashboard P&L, per-strategy attribution). If it's not green in paper, stop.
2. **Tiny-live soak ($4–$50).** Flip one strategy to `paperOnly:false` with a small `maxSizeUsd`. Verify, end-to-end, real round trips:
   - [ ] Real BUY fills and reconciles → appears in `positions`.
   - [ ] Take-profit, stop-loss, and max-hold each produce a real SELL that fills (watch for `Exit — cross to close position`).
   - [ ] No retry spam / duplicate orders (check `runner_real_skipped_in_flight`, `real_order_skipped_duplicate_signal`).
   - [ ] Telegram alerts arrive for fills, exits, `needs_review`, and kill-switch.
   - [ ] Restart the service mid-soak → confirm risk mode / daily-loss / drawdown / kill-switch restored and no second loop runs.
3. **Scale in steps**, only after the above is clean. Raise per-strategy `maxSizeUsd` and portfolio caps gradually; keep alerts on.

### Capital scale ladder (after tiny-live soak)

| Step | Capital | Gate |
|------|---------|------|
| 1 | ~$13 | 48h soak, ≥1 filled SELL, no manual DB edits |
| 2 | ~$25 | 72h clean, win rate + flip count tracked in `/real` ops |
| 3 | ~$50 | 1 week clean, zero `needs_review` backlog |

Do not skip steps. If reconciliation breaks at any step, revert capital and fix before proceeding.

## Incident playbooks

### Flush stuck exits

When positions should exit but no SELL is pending:

```bash
railway run -- npx tsx scripts/flush-real-exits.ts
```

Re-check `/api/real/ops` for pending SELLs. For ask-only books the executor posts a limit SELL fallback — monitor with:

```bash
railway run -- npx tsx scripts/monitor-real-exits.ts
```

Inspect order books for dead markets:

```bash
railway run -- npx tsx scripts/inspect-position-books.ts
```

### Runner lock stuck

Symptoms: runner won't start, audit shows lock held by stale instance.

1. Check lease: `SELECT value, updated_at FROM system_state WHERE key = 'runner_lock';`
2. If heartbeat is >5 min old, the next cycle from a healthy instance should take over (stale lock takeover).
3. Manual recovery: stop runner from UI, redeploy, or delete stale `runner_lock` row **only** when no runner is actually running.
4. Verify single replica on Railway when live.

### Ghost positions (ledger vs chain)

When ledger shows open positions but on-chain balance is zero:

```bash
# Dry run
railway run -- npx tsx scripts/reconcile-ledger-vs-chain.ts

# Apply — cancels phantom pending/needs_review BUYs
APPLY=1 railway run -- npx tsx scripts/reconcile-ledger-vs-chain.ts
```

Review output for ghost markets and dead-book positions. Cancel or write off via script before re-entering those markets.

## When something goes wrong

1. Set `SNIPER_DISABLE_REAL_EXECUTION=true` (or call `disableRealExecution`).
2. Review recent audit events + runner logs.
3. Reconcile/flatten any stuck trades (queries below); cross-check on-exchange balances.
4. Post-mortem; decide whether to roll back strategies/variants.

## Verification queries

```sql
-- Open / stuck real orders
SELECT id, platform, market_external_id, side, status, signal_id, created_at, tx_hash
FROM real_trades
WHERE status IN ('pending', 'needs_review')
ORDER BY created_at DESC
LIMIT 50;

-- Recent real fills + position snapshot
SELECT rt.id, rt.platform, rt.market_external_id, rt.side, rt.status, rt.size, rt.price, rt.fee, rt.filled_at
FROM real_trades rt
WHERE rt.status = 'filled'
ORDER BY rt.filled_at DESC
LIMIT 20;

-- Current real holdings (exposure truth)
SELECT platform, market_id, side, size_shares, avg_price
FROM positions
WHERE ABS(CAST(size_shares AS double precision)) > 0.01;

-- Reconciliation + safety activity
SELECT actor, action, payload, created_at
FROM audit_events
WHERE actor IN ('reconciliation', 'real-executor', 'system-state')
ORDER BY created_at DESC
LIMIT 50;

-- Single-runner lease (who holds it)
SELECT value, updated_at FROM system_state WHERE key = 'runner_lock';
```

## Known limitations

- Real path is **not CI-tested with live keys** (decision-level logic is unit-tested).
- Kalshi real execution remains partial vs Polymarket.
- Per-market exposure keys differ between `positions` (marketId) and pending `real_trades` (externalId); the exposure ceiling can over-count slightly (conservative — safe).
- Daily P&L baseline uses cost basis for open positions (slight overnight skew on the daily-loss breaker).
