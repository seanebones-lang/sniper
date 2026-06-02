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
- Recent recon cycles now ping `getBalance()` via the trading client on pending Kalshi trades (see `kalshi_recon_balance_check` audits) — excellent liveness signal.

## Auth Setup (Exact Steps)
1. Obtain `KALSHI_ACCESS_KEY` from Kalshi dashboard (API section).
2. Generate RSA private key (e.g. `openssl genrsa -out kalshi_private.pem 2048`).
3. Register the public key in Kalshi (copy from .pem or convert).
4. Set both `KALSHI_ACCESS_KEY` and `KALSHI_RSA_PRIVATE_KEY` (full PEM content or path — client handles) in env.
5. The client auto logins on first use and caches token (~24h typical).
6. Test: the recon or a manual `getKalshiTradingClient().getBalance()` should succeed without 401.

## Common Error Patterns & Gotchas
- `401 Unauthorized`: Key mismatch, expired token (client retries login), or wrong PEM format (must include BEGIN/END).
- `400 Bad Request on placeOrder`: Price must be in cents (1-99), count integer, ticker exact (use externalId from our markets).
- Side mapping: Our BUY=Yes, SELL=No for binary event contracts.
- Rate limits: Kalshi is strict; the client + runner already throttle via risk/execution layers.
- Pending orders: Kalshi may keep limit orders open; our recon only time-based flags for now (future: poll /portfolio/orders).

## Reconciliation Specifics for Kalshi
- Runner calls `reconcilePendingRealTrades()` on every cycle when real enabled.
- For Kalshi pendings >5-10min: client balance ping + audit.
- Very old pendings (>10min): `kalshi_real_trade_pending_review` audit + manual review recommended.
- To manually close a confirmed fill: use the exported `recordRealFill({tradeId, filledSize, filledPrice})` from `lib/execution/reconcile-real-trades`.
- Always pair with `ensureMarket` for any direct position writes (ID discipline).

## Future Work (Prioritized)
- Implement `getOrder(tickerOrId)` + `getFills` in KalshiTradingClient.
- Auto call `recordRealFill` from recon when Kalshi confirms a fill.
- Wire Kalshi WS messages into runner/strategies for micro-structure signals (currently UI-only on detail pages).
- Full parity with Polymarket real execution paths + tests.
