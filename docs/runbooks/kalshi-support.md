# Kalshi Support Runbook

## Current State (June 2026)
- Market discovery and order books: Functional via public REST.
- WebSocket: Client exists and is wired into the market detail UI for live updates.
- Authenticated trading: Full client with login, getBalance, placeOrder, getOrder, getOrders, and getFills.
- Real execution: Hardening — active order status polling and fill reconciliation in the runner. Auto-calls recordRealFill on confirmed fills. Balance pings + fills discovery.

## Configuration
- `KALSHI_ACCESS_KEY` and `KALSHI_RSA_PRIVATE_KEY` are required for authenticated operations.
- Real execution on Kalshi follows the same gates as Polymarket (`SNIPER_ENABLE_REAL_EXECUTION`, strategy `paperOnly`, risk checks).

## Known Gaps
- Deeper partial fill, fee, and multi-leg handling still needed.
- Some advanced order types (market orders with better guarantees, etc.) remain thin.

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
- Runner calls `reconcilePendingRealTrades()` every cycle.
- Actively polls via `getOrderStatus` (and `getFills` as secondary source) using the order ID stored in `txHash`.
- Confirmed fills automatically call `recordRealFill` and update positions.
- Very old unconfirmed trades are marked `needs_review`.
- Always use `ensureMarket` before any direct position writes.

## Future Work (Prioritized)
- Stronger partial fill, fee, and position marking accuracy in reconciliation.
- Better Polymarket reconciliation parity.
- Integration of Kalshi WebSocket data into the runner and strategies.
- Proactive alerting for stuck real trades or kill-switch events.
