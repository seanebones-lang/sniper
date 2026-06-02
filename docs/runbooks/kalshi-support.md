# Kalshi Support Runbook

## Current State (June 2026)
- Market discovery and order books: Functional via public REST.
- WebSocket: Client exists and is wired into the market detail UI for live updates.
- Authenticated trading: Basic client skeleton with login + placeOrder (RSA key auth).
- Real execution: Partial — can submit orders via the trading client when enabled, but fill confirmation and full flows are still thin.

## Configuration
- `KALSHI_ACCESS_KEY` and `KALSHI_RSA_PRIVATE_KEY` are required for authenticated operations.
- Real execution on Kalshi follows the same gates as Polymarket (`SNIPER_ENABLE_REAL_EXECUTION`, strategy `paperOnly`, risk checks).

## Known Gaps
- Full order status polling and fill reconciliation for Kalshi is still basic (mostly time-based + audit for now).
- Some advanced order types and portfolio endpoints in the trading client are not yet implemented.

## Operational Notes
- Monitor the "kalshi_real_order_result" and "kalshi_real_order_failed" audit events when running real on Kalshi.
- Start with very small sizes.
- The reconciliation job will flag old pending Kalshi trades for manual review.

## Future Work
- Stronger fill confirmation for Kalshi real trades.
- Balance and position queries via the trading client.
- Deeper integration of Kalshi WS into the runner (currently mainly UI).
