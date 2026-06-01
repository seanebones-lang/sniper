# Research: Sniper MVP — Polymarket + Kalshi 24/7 System (Phase 0/1)

**Date**: 2026-06-01  
**Status**: Initial notes — expand during Phase 1.

## API & Platform Notes

### Polymarket (CLOB V2, post April 28 2026 upgrade)
- Primary endpoints: Gamma (public market discovery), CLOB `https://clob.polymarket.com` (order books + trading).
- Official TS SDK: `@polymarket/clob-client-v2` (requires viem for EIP-712 signing).
- Auth: L1 (wallet) → derive L2 API key/secret/passphrase. Heartbeats mandatory (~10s) or open orders cancel.
- WebSocket: `wss://ws-subscriptions-clob.polymarket.com/ws/market` (public, asset_ids = token IDs). User channel requires L2 creds.
- Key gotchas: neg_risk markets, tick sizes per market, pUSD collateral, proxy/Gnosis Safe support, on-chain settlement finality delays.
- Rate limits & best practices: documented in https://docs.polymarket.com/.

### Kalshi
- REST: `https://external-api.kalshi.com/trade-api/v2`
- WS: `wss://external-api-ws.kalshi.com/trade-api/ws/v2`
- Auth: RSA-PSS (SHA256) signatures on every request (timestamp + method + path). Demo env strongly recommended.
- Public market data endpoints excellent for discovery.
- Good OpenAPI + AsyncAPI specs available for client gen.
- Demo vs prod keys are separate — never mix.

## Candidate Edges for "Small Consistent Profit" (User Must Validate)

1. **Wide-spread scalping on liquid short-term markets** (BTC/ETH 5m/15m/1h "will price be above X?").
   - Enter when spread > 1.5-2.5% (taker), exit at 0.8-1.2% or fixed % target + time stop.
   - Requires fast WS + low latency execution.

2. **Simple threshold / mean-reversion** vs last trade or volume-weighted proxy.
   - Works best on mean-reverting or news-overreacting periods.

3. **Cross-venue arb (Polymarket ↔ Kalshi)**.
   - For *identical* events: buy the cheaper Yes (or No) on one side and the cheaper complementary on the other when YesA + YesB < 1 - fees.
   - Practical friction: different resolution sources sometimes, funding speed, KYC, withdrawal, gas vs bank rails.
   - Many existing bots focus here on crypto short-term markets.

**Strong recommendation**: Start with #1 and #2 on a handful of high-volume short-duration crypto markets. Only add cross-arb after manual mapping + weeks of paper data.

## Risk Model (MVP)

- Max 1-3% of bankroll per market (configurable).
- Daily loss circuit breaker: 5-8% of bankroll → auto pause all strategies.
- Per-strategy cooldown after fill.
- Hard position caps (no pyramiding in MVP).
- All decisions logged with full context (book snapshot + params at decision time).

## Open Questions for Phase 1

- Best way to discover "short-term crypto markets" programmatically across both platforms?
- Token ID vs condition ID mapping for Polymarket (Gamma vs CLOB).
- How to handle partial fills and reconciliation reliably?
- Kalshi order book delta format vs Polymarket snapshot + price_change.

## References

- https://docs.polymarket.com/ (especially quickstart, websocket/market-channel, v2-migration)
- https://docs.kalshi.com/ (quick starts for market data, authenticated requests, websockets)
- Existing open-source bots (study for edge ideas + anti-patterns, never copy keys or execution blindly).

Add concrete API response examples, rate limit numbers, and gotcha list as you integrate clients.
