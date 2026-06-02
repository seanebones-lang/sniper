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

**Coverage today:** 57 unit tests (15 files), 14 smoke checks, 14 e2e specs. No tests for full runner loop, strategies `evaluate()`, or real execution.

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
| **P1** | `realisticPassiveFills` ignored in replay | Implement in `replayStrategyOnHistory()` |
| **P2** | Variants in-memory | Persist to DB |
| **P2** | Runner / `evaluate()` integration tests | Add mocked-book runner tests to CI |
| **P2** | Runner WS book feed | Optional WS cache in runner loop |

**Recently resolved (June 2026):** FK mismatch, paper/risk split brain, USD↔shares sizing, `incrementRunCount`, edge decay wiring, Grok proposal parsing.

---

## Known Gaps & Open Work

Full matrix: [docs/STATUS.md](docs/STATUS.md). Summary:

### Data & Markets

| Item | Severity | Notes |
|------|----------|-------|
| Market cache TTL ~25s | Low | Force refresh on quick-flip cycles |
| Kalshi WS on market detail | Works | REST books in runner |

### Execution & Paper

| Item | Severity | Notes |
|------|----------|-------|
| Replay “realistic passive fills” toggle | **Bug** | UI/API pass flag; replay ignores it |
| True queue simulation for passive fills | Medium | Improved imbalance/regime wiring; not full queue sim |
| Resting order management in live runner | Medium | REST book cache; no continuous WS in runner |
| Partial fill reconciliation | Medium | Real path only |

### Strategies & Research

| Item | Severity | Notes |
|------|----------|-------|
| Strategy variants persistence | Medium | In-memory only |
| Cross-venue arb strategy | Low | Not implemented |
| Runner / `evaluate()` tests | Medium | Not in CI |
| Historical replay needs snapshot data | Expected | Run runner before replay |

### UI / UX

| Item | Severity | Notes |
|------|----------|-------|
| `/real` page | Low | Does not read server execution flag |
| Decision log export | Medium | Audits in `/api/health`; no export UI |

### Infrastructure & Testing

| Item | Severity | Notes |
|------|----------|-------|
| Unit test coverage | Medium | 57 tests; runner loop not covered |
| CI smoke tests | Low | Not in GitHub Actions |
| E2e depends on live Polymarket API | Low | Flaky if API down |

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
2. **Implement replay realistic passive fills** — honor flag in `replayStrategyOnHistory()`.
3. **Add unit tests for a strategy** — e.g. `spread-scalper` with mock order book contexts.
4. **Runner integration test** — mocked books, single cycle, assert signal/fill path.
5. **Export audit log API** — `GET /api/audit?limit=100` from `audit_events` table.
6. **Fix `/real` page** — show actual execution gate status from `/api/health`.
7. **Mock Polymarket in CI smoke tests** — reduce external API dependency.
8. **Runner WS book cache** — optional Kalshi/Polymarket WS for hot quick-flip set.

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
