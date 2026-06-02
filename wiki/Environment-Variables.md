# Environment Variables

Copy `.env.example` to `.env.local` for local development. **Never commit `.env.local`.**

Server-side secrets are never exposed to the browser.

---

## Required

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |

**Example (local Docker):**
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/sniper
```

---

## Paper mode (default)

No additional variables required. Paper trading works out of the box with a database.

---

## Real execution (opt-in)

| Variable | Description |
|----------|-------------|
| `SNIPER_ENABLE_REAL_EXECUTION` | Must be `true` to allow real orders |
| `POLYMARKET_PRIVATE_KEY` | Wallet private key for Polymarket CLOB |

**Requirements for real orders:**
1. `SNIPER_ENABLE_REAL_EXECUTION=true`
2. Strategy with `paperOnly: false` in DB
3. Risk checks pass
4. ExecutionManager approves

Use a **dedicated low-balance wallet**. Never commit this key.

Kalshi real execution variables exist in `.env.example` but the executor returns "not yet implemented."

---

## Grok / xAI (optional)

| Variable | Description |
|----------|-------------|
| `XAI_API_KEY` | xAI API key (overrides Settings UI file) |
| `ENABLE_GROK_RESEARCH_AGENT` | `true` for periodic runner Grok analysis |

Alternatively, set the key via **Settings** UI (`/settings`) — stored in `data/user-settings.json` (gitignored).

---

## Telegram alerts (optional)

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Target chat ID |

Strongly recommended for 24/7 unattended operation.

---

## Local dev / testing

| Variable | Description | Default |
|----------|-------------|---------|
| `SMOKE_BASE_URL` | Base URL for smoke tests | `http://localhost:3001` |
| `PLAYWRIGHT_BASE_URL` | Base URL for e2e tests | `http://localhost:3001` |

Use these when dev server runs on a non-default port:

```bash
npm run dev -- -p 3001
SMOKE_BASE_URL=http://localhost:3001 npm run test:smoke
```

---

## Railway deployment

Set variables in Railway service **Variables** (secrets):

1. `DATABASE_URL` — from Postgres plugin
2. Optional: `XAI_API_KEY`, `ENABLE_GROK_RESEARCH_AGENT`
3. Optional (real trading): `SNIPER_ENABLE_REAL_EXECUTION`, `POLYMARKET_PRIVATE_KEY`
4. Optional: Telegram tokens

After first deploy, run `npm run db:push` in Railway shell.

---

## Security notes

| Rule | Reason |
|------|--------|
| Never commit `.env.local` | Contains secrets |
| Never put trading keys in client code | Browser exposure |
| Use env for real execution flags | Server-side gate only |
| Settings UI key is gitignored | `data/` is in `.gitignore` |

---

## Related pages

- [Getting Started](Getting-Started)
- [Operations](Operations)
- [Execution Layer](Execution-Layer)
