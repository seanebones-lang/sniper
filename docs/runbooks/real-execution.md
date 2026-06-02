# Real Execution Runbook

## Overview
This document describes how to safely operate real money execution on Sniper.

## Enabling Real Execution
1. Set `SNIPER_ENABLE_REAL_EXECUTION=true` in your environment (Railway secrets, .env, etc).
2. Ensure the strategy you want to run has `paperOnly: false`.
3. The runner will only place real orders when **all** of the following are true:
   - The env flag is set
   - The strategy allows real trading
   - Portfolio risk allows the size
   - ExecutionManager does not recommend WAIT/CANCEL

## Emergency Kill Switch
- Set `SNIPER_DISABLE_REAL_EXECUTION=true` in the environment for an immediate hard stop (highest priority, checked first).
- Runtime disable via `disableRealExecution()` is now durable (persisted in `system_state`).
- The runner recovers the kill switch state on startup and logs loudly if it was previously disabled.
- Risk snapshots also capture the full posture (exposure + mode + health + maxDrawdown) at the time of any incident.

## Reconciliation
- The runner periodically calls `reconcilePendingRealTrades()`.
- Kalshi: Actively polls order status via `getOrder`/`getFills` and auto-reconciles confirmed fills using `recordRealFill`.
- Polymarket: Basic open-order reconciliation (detects when orders are no longer open).
- Durable risk snapshots and positions table are the source of truth for exposure after reconciliation.
- Monitor "real_fill_reconciled", "kalshi_real_fill_confirmed_via_api", and "polymarket_order_no_longer_open" audit events.

## Monitoring & Alerts
- Telegram alerts are sent for real orders when configured.
- Check `/health` and the runner status for system health.
- Watch for high adverse selection or low system health scores.

## Best Practices
- Start very small (e.g., max $25–50 per trade).
- Use the real execution page confirmation flow.
- Review all Grok recommendations carefully before applying variants that affect real trading.
- Have a manual review process for any promoted variants that will run with real capital.

## Known Limitations (as of June 2026)
- Kalshi real execution is still partial (client skeleton exists, full flows need more work).
- Position tracking is basic.
- No automatic stop-loss or portfolio-level circuit breakers beyond the risk manager yet.

## When Something Goes Wrong
1. Immediately set the disable env var.
2. Review recent audit events and runner logs.
3. Manually reconcile any stuck trades if needed.
4. Post-mortem and decide whether to roll back variants or strategies.

## Daily Operations Checklist
- [ ] Confirm `SNIPER_ENABLE_REAL_EXECUTION` desired state.
- [ ] Check runner startup logs for recovered kill switch / risk mode / risk snapshot state.
- [ ] Review `/health` (now includes lastRiskSnapshot and durable state).
- [ ] Monitor for elevated maxDrawdown or high exposure in recovered snapshots.
- [ ] Spot-check `realTrades` for pending/needs_review states.
- [ ] Review recent "real_fill_reconciled" and platform-specific fill confirmation audits.
- [ ] (Paper sacred) Never promote a variant to real without full replay + small size first.

## Verification Queries & Commands
Use these to audit real execution health:

```sql
-- Pending real trades (stuck candidates)
SELECT id, platform, marketExternalId, side, status, createdAt, txHash
FROM real_trades
WHERE status = 'pending'
ORDER BY createdAt DESC
LIMIT 20;

-- Recent real fills + positions snapshot
SELECT rt.id, rt.platform, rt.marketExternalId, rt.status, rt.size, rt.price, p.sizeShares, p.avgPrice
FROM real_trades rt
LEFT JOIN positions p ON p.platform = rt.platform AND p.marketId = (
  SELECT id FROM markets WHERE externalId = rt.marketExternalId LIMIT 1
)
WHERE rt.status = 'filled'
ORDER BY rt.filledAt DESC
LIMIT 10;

-- Reconciliation activity
SELECT action, payload, createdAt
FROM audit_events
WHERE actor = 'reconciliation' OR action LIKE 'kalshi_recon%'
ORDER BY createdAt DESC
LIMIT 30;
```

In code / logs: look for `runner_signal_created` with real context, `real_fill_reconciled`, `kalshi_recon_balance_check`.

## Position & Fill Audit Steps
1. Run the queries above.
2. Cross-check on-exchange balances (Kalshi dashboard / Polymarket portfolio) vs local `positions` + recent `real_trades`.
3. For a specific fill: call `recordRealFill({tradeId, filledSize, filledPrice})` manually from a script or admin route if needed (idempotent best-effort).
4. If drift detected: disable real, manual hedge or accept, then post-mortem.

## Kill Switch & Emergency Procedures
- **Hard stop (deployment)**: Set `SNIPER_DISABLE_REAL_EXECUTION=true` (highest priority, checked first in `isRealExecutionAllowed`).
- **Runtime**: Call `disableRealExecution()` (e.g., from health endpoint or REPL in emergency).
- **Persistent option (future)**: Store a `real_execution_enabled` flag in DB/settings; the in-memory + env are current implementation.
- After kill switch: runner continues in paper mode for strategies that have `paperOnly=true` (safe default).
- Re-enable: Remove env var + restart or clear the in-memory flag (add a `resetRealExecution()` helper if operating frequently).

## Known Limitations (Updated)
- Kalshi: Strong order + fills polling in recon. Still needs deeper partial fill and fee handling.
- Polymarket: Basic open-order detection added. Full status polling is thinner than Kalshi.
- MaxDrawdown is now tracked and acts as a circuit breaker (basic historical peak tracking).
- Rich durable `risk_snapshot`s are persisted on every runner cycle and recovered on startup.
- Position math remains pragmatic; full mark-to-market and sophisticated cost basis are future work.
