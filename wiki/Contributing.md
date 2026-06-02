# Contributing

Thank you for helping build a serious prediction-market research and execution platform.

**Before contributing, read [Project Status](Project-Status)** — the verified capability matrix and critical blockers.

---

## Project goals

Sniper is **not** a get-rich-quick bot. Design priorities:

1. **Paper-first safety** — real money is opt-in with multiple gates
2. **Self-protection** — runner throttles unhealthy markets automatically
3. **Research flywheel** — collect → analyze → propose → replay → validate
4. **Execution quality** — adverse selection and fill quality matter
5. **Auditability** — every decision should have a logged reason

If your contribution conflicts with these (e.g. "always trade aggressively"), it likely won't merge.

---

## Development setup

```bash
git clone https://github.com/seanebones-lang/sniper.git
cd sniper
npm install
cp .env.example .env.local
```

### Database (Docker)

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
npm run dev
```

Full setup: [Getting Started](Getting-Started).

---

## Code conventions

| Rule | Detail |
|------|--------|
| TypeScript strict | No `any`; use `unknown` + narrowing |
| ESLint | Must pass (`npm run lint`); CI enforces zero issues |
| Next.js 16 | Check `node_modules/next/dist/docs/` for API changes |
| Minimal diffs | Match surrounding style; no unrelated refactors |
| Secrets | Never commit keys, `.env.local`, or `data/user-settings.json` |
| Paper default | New features must not enable real execution by default |

### Key directories

```
app/           Next.js pages and API routes
lib/           Core logic (strategies, runner, execution, risk, clients)
e2e/           Playwright browser tests
scripts/       Smoke tests and utilities
docs/          Architecture and ops documentation (repo mirror of wiki)
wiki/          GitHub Wiki source (publish with scripts/sync-wiki.sh)
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
| `npm run test:e2e` | Playwright (14 specs) | Dev server |
| `npm run test:all` | Full local suite | Dev server |

When adding features, prefer:
- **Unit tests** for pure logic in `lib/`
- **Smoke assertions** for new API routes in `scripts/smoke-test.mjs`
- **E2e specs** for new user flows in `e2e/`

---

## Pull request checklist

- [ ] `npm run test:ci` passes locally
- [ ] New API routes have smoke coverage (if applicable)
- [ ] No secrets or `.env.local` in the diff
- [ ] Types are explicit (no new `any`)
- [ ] Docs/wiki updated if behavior or env vars changed
- [ ] Real-execution changes clearly gated and documented

---

## Fix these first

See [Known Issues](Known-Issues-and-Roadmap) for full detail.

| Priority | Issue | Fix direction |
|----------|-------|---------------|
| **P0** | `signals.market_id` FK mismatch | Sync markets to DB; insert UUID into signals |
| **P1** | `incrementRunCount()` never called | Call at start of each runner cycle |
| **P1** | `realisticPassiveFills` ignored in replay | Implement in replay engine |
| **P1** | `recordWindow()` never called | Feed performance windows from runner |
| **P2** | Variants in-memory | Persist to DB |
| **P2** | Grok `proposals[]` always empty | Parse model output |

---

## Suggested first contributions

1. Sync discovered markets to `markets` table (P0)
2. Call `incrementRunCount()` in runner (P1)
3. Add unit tests for spread-scalper strategy
4. Export audit log API — `GET /api/audit?limit=100`
5. Kalshi live WS on market detail page
6. Parse Grok RECOMMENDED ACTIONS into structured proposals
7. Fix `/real` page to read server execution flag

Label PRs: `data`, `execution`, `strategy`, `research`, `ui`, `test`, `docs`.

---

## Areas needing deep expertise

| Area | Skills needed |
|------|---------------|
| Kalshi RSA signing + order placement | Kalshi API, crypto signing |
| Queue-position / passive fill simulation | Market microstructure |
| Cross-venue arbitrage | Both APIs, resolution rules |
| ML / feature engineering on snapshots | Time series, `market_snapshots` |
| Production observability | Logging, metrics, alerting |

---

## Getting help

- Read [Architecture](Architecture) before large changes
- Check `specs/001-sniper-mvp/research.md` for platform API notes
- Open a GitHub issue before large refactors
- For real-trading PRs, explain the safety gates you preserved

---

## Code of conduct

Be respectful. This is a high-risk domain — prioritize safety, clarity, and honest documentation over hype.

**The best contribution might be a test, a doc fix, or a bug report — not a new strategy.**
