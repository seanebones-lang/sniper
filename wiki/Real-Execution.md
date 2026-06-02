# Real Execution

Real money execution in Sniper is heavily gated and still considered experimental.

## Current State (June 2026)

- **Durability**: Strong. Kill switch and risk snapshots persist across restarts.
- **Kalshi**: Authenticated client + active order and fill polling in reconciliation.
- **Polymarket**: Gated with basic open-order reconciliation support.
- **Risk Controls**: MaxDrawdown tracking and circuit breaker now active.

## Important Warnings

- Paper mode is the recommended default for long periods.
- Real execution requires `SNIPER_ENABLE_REAL_EXECUTION=true` + per-strategy `paperOnly: false`.
- Always review durable risk snapshots on `/health` and in logs after restarts.

See the full runbook:
- [Real Execution Runbook](https://github.com/seanebones-lang/sniper/blob/main/docs/runbooks/real-execution.md)

See also the [Production Readiness Review](https://github.com/seanebones-lang/sniper/blob/main/docs/PRODUCTION-READINESS.md).