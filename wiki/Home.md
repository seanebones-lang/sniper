# Sniper Wiki

**A research-first automated trading platform for Polymarket and Kalshi.**

> **High-risk personal tool.** Most automated prediction market strategies lose money after fees, slippage, and adverse selection. You can lose all capital. Paper mode is strongly recommended.

## Current Status (June 2026)

See the authoritative sources in the main repository:

- **[docs/STATUS.md](https://github.com/seanebones-lang/sniper/blob/main/docs/STATUS.md)** — Detailed capability matrix
- **[docs/PRODUCTION-READINESS.md](https://github.com/seanebones-lang/sniper/blob/main/docs/PRODUCTION-READINESS.md)** — Honest assessment for using real capital

**Quick Summary:**
- Paper trading is reliable and well supported.
- Real execution has been significantly hardened (durable kill switch + rich risk snapshots, maxDrawdown circuit breaker, active Kalshi reconciliation).
- The system is still considered **experimental** for unsupervised real capital deployment.
- 22 passing unit tests with good coverage of risk and durability mechanisms.

## Key Improvements (Recent)

- **Durable State**: Kill switch, risk mode, daily loss, execution health, and full risk posture now persist across restarts.
- **Risk Safety**: MaxDrawdown tracking and enforcement added.
- **Reconciliation**: Kalshi now has real order/fill polling. Basic support added for Polymarket.
- **Observability**: `/api/health` surfaces persisted risk snapshots.

## Getting Started

See the main [README](https://github.com/seanebones-lang/sniper) for setup instructions.

**Strong recommendation**: Run extensively in paper mode before enabling real execution.

## Important Documents

- [Production Readiness Review](https://github.com/seanebones-lang/sniper/blob/main/docs/PRODUCTION-READINESS.md)
- [Risk Philosophy](https://github.com/seanebones-lang/sniper/blob/main/docs/RISK.md)
- [Execution Layer](https://github.com/seanebones-lang/sniper/blob/main/docs/EXECUTION.md)
- [Real Execution Runbook](https://github.com/seanebones-lang/sniper/blob/main/docs/runbooks/real-execution.md)
- [Kalshi Support Runbook](https://github.com/seanebones-lang/sniper/blob/main/docs/runbooks/kalshi-support.md)

## Contributing

See [AGENTS.md](https://github.com/seanebones-lang/sniper/blob/main/AGENTS.md) for project rules, especially around paper mode being sacred and ID discipline.

## License

See the main repository for license information.