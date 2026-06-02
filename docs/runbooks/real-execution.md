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
- Set `SNIPER_DISABLE_REAL_EXECUTION=true` in the environment for an immediate hard stop (highest priority).
- Call `disableRealExecution()` at runtime if needed (in-memory).

## Reconciliation
- The runner periodically calls `reconcilePendingRealTrades()`.
- This updates `realTrades` status and basic `positions` tracking.
- For now it uses a combination of time-based heuristics and best-effort position math.
- Monitor the "real_trade_pending_review" and "real_fill_reconciled" audit events.

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
- [ ] Confirm `SNIPER_ENABLE_REAL_EXECUTION` desired state for the deployment.
- [ ] Check runner status + recent `real_order_attempt` / `kalshi_recon_balance_check` audit events.
- [ ] Review `/health` and execution health scores (adverse rate, system health).
- [ ] Spot-check `realTrades` for pending >15min (flag for review).
- [ ] Confirm no unexpected balance drift via Kalshi client pings in recon.
- [ ] If risk mode moved to EMERGENCY/DEFENSIVE, note reason from logs.
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
- Kalshi real execution: client + placeOrder + recon pings work; full order polling + auto recordRealFill on confirmed fills still future.
- Position math is pragmatic (simple averaging); sophisticated cost-basis in production.
- No cross-platform netting or automatic circuit breakers beyond PortfolioRiskManager + ExecutionManager yet.
