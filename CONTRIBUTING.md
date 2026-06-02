# Contributing to Sniper

Thank you for your interest in helping build a serious prediction-market research and execution platform.

**Before contributing, read [docs/STATUS.md](docs/STATUS.md)** — the verified capability matrix and critical blockers. Do not assume README marketing language; STATUS is authoritative.

This document covers **how to contribute**, **conventions**, and **where to start fixing**.

## Table of Contents

1. [Project Goals](#project-goals)
2. [Development Setup](#development-setup)
3. [Code Conventions](#code-conventions)
4. [Testing](#testing)
5. [Pull Request Checklist](#pull-request-checklist)
6. [Architecture Quick Reference](#architecture-quick-reference)
7. [Known Gaps & Open Work](#known-gaps--open-work)
8. [Suggested First Contributions](#suggested-first-contributions)
9. [Areas Needing Deep Expertise](#areas-needing-deep-expertise)
10. [Getting Help](#getting-help)

---

## Project Goals

Sniper is **not** a get-rich-quick bot. The design priorities are:

1. **Paper-first safety** — real money is opt-in with multiple gates.
2. **Self-protection** — the runner throttles unhealthy markets and shifts risk modes automatically.
3. **Research flywheel** — collect snapshots → analyze → propose → replay → validate.
4. **Execution quality** — adverse selection and fill quality matter as much as signals.
5. **Auditability** — every decision should have a logged reason.

If your contribution conflicts with these (e.g. "always trade aggressively"), it likely won't merge.

---

## Development Setup

### 1. Clone and install

```bash
git clone https://github.com/seanebones-lang/sniper.git
cd sniper
npm install
cp .env.example .env.local
```

### 2. Database

**Docker (recommended locally):**

```bash
docker run -d --name sniper-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=sniper \
  -p 5433:5432 postgres:16
```

```bash
# .env.local
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/sniper
npm run db:push
```

### 3. Run dev server

```bash
npm run dev
# or if port 3000 is taken:
npm run dev -- -p 3001
```

### 4. Verify

```bash
npm run test:ci          # lint + build + unit (no server needed)
npm run test:smoke         # needs dev server running
npm run test:e2e           # Playwright (local: needs dev server on :3001 by default)
```

---

## Code Conventions

- **TypeScript strict** — no `any`; use `unknown` + narrowing or shared types in `lib/`.
- **ESLint** — must pass (`npm run lint`). CI enforces zero issues.
- **Next.js 16** — this is not standard Next.js; check `node_modules/next/dist/docs/` for API changes before editing App Router code.
- **Minimal diffs** — match surrounding style; don't refactor unrelated code in the same PR.
- **Secrets** — never commit keys, `.env.local`, or `data/user-settings.json`. Grok keys can be stored via Settings UI (`data/` is gitignored).
- **Paper default** — new features should not enable real execution by default.

### Key directories

```
app/           Next.js pages and API routes
lib/           Core logic (strategies, runner, execution, risk, clients)
e2e/           Playwright browser tests
scripts/       Smoke tests and utilities
docs/          Architecture and ops documentation
specs/         MVP specification artifacts
```

---

## Testing

| Command | What it does | Requires |
|---------|--------------|----------|
| `npm run lint` | ESLint | — |
| `npm run build` | Production build + TypeScript | — |
| `npm test` | Vitest unit tests | — |
| `npm run test:ci` | lint + build + unit | — |
| `npm run test:smoke` | HTTP API smoke tests | Dev server |
| `npm run test:e2e` | Playwright (14 specs) | Dev server (local) |
| `npm run test:all` | Full local suite | Dev server |

**CI** (`.github/workflows/ci.yml`): ESLint → build + unit → e2e with Postgres. **Smoke tests are not in CI.**

**Coverage today:** 8 unit tests (2 files), 14 smoke checks, 14 e2e specs. No tests for runner, strategies, risk, or real execution.

When adding features, prefer:

- **Unit tests** for pure logic in `lib/` (see `lib/orderbook.test.ts`, `lib/execution/paper-simulator.test.ts`).
- **Smoke assertions** for new API routes in `scripts/smoke-test.mjs`.
- **E2e specs** for new user-facing flows in `e2e/`.

---

## Pull Request Checklist

- [ ] `npm run test:ci` passes locally
- [ ] New API routes have smoke coverage (if applicable)
- [ ] No secrets or `.env.local` in the diff
- [ ] Types are explicit (no new `any`)
- [ ] Docs updated if behavior or env vars changed
- [ ] Real-execution changes clearly gated and documented

---

## Architecture Quick Reference

| Layer | Location | Notes |
|-------|----------|-------|
| Market clients | `lib/clients/polymarket.ts`, `lib/clients/kalshi.ts` | Gamma + CLOB; Kalshi REST |
| WebSockets | `lib/ws/polymarket.ts`, `lib/ws/kalshi.ts` | Heartbeats + reconnect |
| Strategies | `lib/strategies/` | 4 strategies, pluggable `evaluate()` |
| Runner | `lib/runner/engine.ts` | 24/7 loop, snapshots, Grok periodic calls |
| Execution | `lib/execution/` | ExecutionManager, paper simulator, real executor |
| Risk | `lib/risk/`, `lib/monitoring/` | Portfolio, risk modes, edge decay, AI recs |
| Research | `lib/research/`, `lib/data/historical.ts` | Grok agent, replay, proposals |
| DB schema | `lib/db/schema.ts` | Drizzle — source of truth |
| Settings | `lib/settings/keys.ts`, `app/settings/` | xAI key storage (file or env) |

**API routes:** [docs/STATUS.md#api-routes](docs/STATUS.md#api-routes).

---

## Critical blockers (fix these first)

See [docs/STATUS.md#critical-blockers](docs/STATUS.md#critical-blockers) for full detail.

| Priority | Issue | Fix direction |
|----------|-------|-------------|
| **P0** | `signals.market_id` FK — runner uses API id, schema expects DB UUID | Sync markets to `markets` table; insert UUID into signals |
| **P1** | `incrementRunCount()` never called | Call at start of each runner cycle |
| **P1** | `realisticPassiveFills` ignored in replay | Implement in `replayStrategyOnHistory()` |
| **P1** | `edgeDecayMonitor.recordWindow()` never called | Feed performance windows from runner |
| **P2** | Variants in-memory | Persist to DB |
| **P2** | Grok `proposals[]` always empty | Parse model output or tool calls |

---

## Known Gaps & Open Work

Full matrix: [docs/STATUS.md](docs/STATUS.md). Summary:

### Data & Markets

| Item | Severity | Notes |
|------|----------|-------|
| Markets not synced to `markets` DB table | **Bug / P0** | Runner signal insert fails FK; automated fills blocked |
| Polymarket `externalId` must be CLOB token ID | Fixed | Was using market id; order books broke. Documented in smoke tests |
| Order book bid/ask sort order | Fixed | Unsorted books produced wrong mid (~50¢ vs ~0.15¢) |
| Market cache TTL ~25s | Low | `lib/markets.ts` — configurable timeout exists |
| Kalshi WS on market detail page | Low | UI says Polymarket-only for live toggle |

### Execution & Paper

| Item | Severity | Notes |
|------|----------|-------|
| Kalshi real execution | High | `real-executor.ts` returns "not yet implemented" |
| Replay “realistic passive fills” toggle | **Bug** | UI/API pass flag; `replayStrategyOnHistory()` ignores it |
| Temporary adjustment expiration | **Bug** | `incrementRunCount()` never called |
| Edge decay → risk mode | **Bug** | `recordWindow()` never called |
| True queue simulation for passive fills | Medium | Paper uses simplified fill model |
| Resting order management in live runner | Medium | ExecutionManager has logic; not fully wired to continuous book updates |
| Partial fill reconciliation | Medium | Not implemented |
| `positions` table | Medium | Schema exists; not fully updated on fills |

### Strategies & Research

| Item | Severity | Notes |
|------|----------|-------|
| Cross-venue arb strategy | Low | Mentioned in specs; not implemented |
| Grok structured proposal extraction | Medium | Agent returns text; `proposals[]` parsing not implemented |
| Strategy variants persistence | Medium | `lib/strategies/variants.ts` is **in-memory only** — lost on restart |
| Performance attribution | Medium | `lib/research/performance.ts` is lightweight placeholder |
| Resolution proximity `endDate` | Low | Uses volume/liquidity proxy instead of real market metadata |
| Historical replay needs snapshot data | Expected | Run runner 48h+ before replay shows trades |

### UI / UX

| Item | Severity | Notes |
|------|----------|-------|
| `/real` page | Low | Does not read server `SNIPER_ENABLE_REAL_EXECUTION` flag |
| Dashboard stats | Low | Basic; could show live runner metrics |
| Decision log export | Medium | Audit events exist in DB; no export UI |
| Global kill switch in UI | Medium | Runner stop exists; no dedicated emergency UI |

### Infrastructure & Testing

| Item | Severity | Notes |
|------|----------|-------|
| Unit test coverage | Medium | 8 tests in 2 files only |
| CI smoke tests | Low | Not in GitHub Actions workflow |
| E2e depends on live Polymarket API | Low | Flaky if API down |
| Database migrations | Low | Using `drizzle-kit push`; formal migrations folder exists but push is primary |

### Security

| Item | Severity | Notes |
|------|----------|-------|
| API routes unauthenticated | Expected | Personal tool; add auth if multi-user |
| Real execution double-gate | OK | Env flag + `paperOnly` on strategy + risk checks |
| Settings key in `data/user-settings.json` | OK | Gitignored; env key takes precedence |

---

## Suggested First Contributions

Good **first PR** targets (self-contained, high value):

1. **Persist strategy variants to DB** — replace in-memory store in `lib/strategies/variants.ts`.
2. **Sync discovered markets to `markets` table** — fix signal `market_id` FK issue in runner.
3. **Add unit tests for a strategy** — e.g. `spread-scalper` with mock order book contexts.
4. **Export audit log API** — `GET /api/audit?limit=100` from `audit_events` table.
5. **Kalshi live WS on market detail** — mirror Polymarket toggle for Kalshi tickers.
6. **Parse Grok RECOMMENDED ACTIONS** into `StrategyProposal[]` in `grok-agent.ts`.
7. **Improve performance attribution** — proper joins between signals and paper_trades.
8. **Mock Polymarket in CI smoke tests** — reduce external API dependency.
9. **Document strategy config fields** — already labeled in UI; mirror in `docs/STRATEGIES.md`.
10. **Fix `/real` page** — show actual `SNIPER_ENABLE_REAL_EXECUTION` status from API.

Label PRs with area tags if possible: `data`, `execution`, `strategy`, `research`, `ui`, `test`, `docs`.

---

## Areas Needing Deep Expertise

These are valuable but **not beginner-friendly**:

| Area | Skills needed | Why it matters |
|------|---------------|----------------|
| Kalshi RSA signing + order placement | Kalshi API, crypto signing | Second venue for real execution |
| Queue-position / passive fill simulation | Market microstructure | Realistic paper P&L |
| Cross-venue arbitrage | Both APIs, resolution rules | Spec'd edge type #3 |
| ML / feature engineering on snapshots | Time series, `market_snapshots` | Regime detection, edge decay |
| Production observability | Logging, metrics, alerting | 24/7 unattended operation |
| Formal Drizzle migrations | SQL, zero-downtime deploys | Safer Railway deploys |

---

## Getting Help

- Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before large changes.
- Check [specs/001-sniper-mvp/research.md](specs/001-sniper-mvp/research.md) for platform API notes.
- Open a GitHub issue describing the gap you're tackling before large refactors.
- For real-trading-related PRs, explain the safety gates you preserved.

---

## Code of Conduct

Be respectful. This is a high-risk domain — prioritize safety, clarity, and honest documentation over hype.

**Remember:** the best contribution might be a test, a doc fix, or a bug report — not a new strategy.
