<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Sniper Project Rules (for AI agents & contributors)

**Core Philosophy (non-negotiable)**
- Paper mode is sacred. Real execution (`SNIPER_ENABLE_REAL_EXECUTION=true`) is opt-in, heavily gated, and never the default.
- Self-protection > cleverness. The system must detect when it is getting hurt and reduce risk automatically.
- Everything must be auditable. Every signal, size decision, and fill must have a traceable reason (see `audit_events` table and `logAudit` calls).

**ID Discipline (prevents FK disasters)**
- Never insert into `signals`, `positions`, or `paper_trades`/`real_trades` using raw external market IDs.
- Always call `ensureMarketRecord(market)` (from `@/lib/markets` or `@/lib/db/ensure-market`) first and use the returned internal UUID for `marketId`.
- The `Market.id` field coming from `fetch*Markets()` / `getAllMarkets()` is **not** a database UUID. Treat it as external.

**Risk & Execution**
- All sizing decisions should go through `portfolioRiskManager.calculateSafeSize` + `ExecutionManager`.
- Respect current `riskModeManager` (NORMAL / DEFENSIVE / EMERGENCY).
- Temporary adjustments from the Grok research agent expire automatically.

**When Adding Strategies**
- Implement the `evaluate(ctx, config)` interface (see `lib/strategies/`).
- Return `edge` + `confidence` when possible so the risk system can use them.
- Prefer small, somewhat uncorrelated edges over "perfect" strategies.

**Data & Research**
- High-resolution snapshots in `market_snapshots` are one of the highest-leverage assets. Enrich them.
- The Grok Research Agent path (`lib/research/grok-agent.ts`) should produce structured, actionable output.

**Never**
- Hardcode real money execution without the full gate checks.
- Skip audit logging on important decisions.
- Bypass the risk/execution layers for "just this one thing".

**Real Execution & Reconciliation (Highest Stakes)**
- Only `placeRealOrder` (via real-executor) may touch live money. It enforces: env gate + strategy !paperOnly + `isRealExecutionAllowed()` (env override + in-memory kill switch) + portfolioRiskManager + ExecutionManager decision.
- Always call `ensureMarket` (or `ensureMarketRecord`) **before** any insert into signals/positions/realTrades that references a market. Example:
  ```ts
  const marketDbId = await ensureMarket({
    platform: m.platform,
    externalId: m.externalId,
    question: m.question,
  });
  await db.insert(signals).values({ marketId: marketDbId, ... });
  ```
- Reconciliation (`reconcilePendingRealTrades`) runs in the runner loop. It must produce auditable events and may call `recordRealFill` / `recordRealFillForPosition` on confirmed fills. Kalshi path exercises the trading client (balance pings etc.).
- Kill switch: `SNIPER_DISABLE_REAL_EXECUTION=true` (deployment) or `disableRealExecution()` (runtime). After trigger, real paths must early-return with clear error; paper paths continue.
- Test the gates: any change to real-exec or recon requires guarded tests that exercise the disable + early return without side effects.

See also:
- `docs/STATUS.md` (authoritative capability + known issues)
- `docs/ARCHITECTURE.md`, `docs/RISK.md`, `docs/EXECUTION.md`
- `specs/`
