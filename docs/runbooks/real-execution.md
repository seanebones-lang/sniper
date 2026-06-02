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
