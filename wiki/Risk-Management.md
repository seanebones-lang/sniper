# Risk Management

Sniper places heavy emphasis on self-protection.

Key components:

- **PortfolioRiskManager** — Exposure limits, category limits, Kelly sizing, and (as of 2026) maxDrawdown circuit breaker.
- **RiskModeManager** — Automatic shifting between NORMAL / DEFENSIVE / EMERGENCY based on system health.
- **Durable Risk Snapshots** — Risk posture (exposure, mode, health, drawdown) is now persisted and recovered on restart.

For the most up-to-date details, see:
- [docs/RISK.md](https://github.com/seanebones-lang/sniper/blob/main/docs/RISK.md)
- [docs/PRODUCTION-READINESS.md](https://github.com/seanebones-lang/sniper/blob/main/docs/PRODUCTION-READINESS.md) (Risk Exposure section)