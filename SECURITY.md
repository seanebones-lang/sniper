# Security Policy

Sniper is a single-operator trading platform with optional real-money execution.
Treat every deployment as production.

## Deployment hardening checklist

- **Set `SNIPER_API_SECRET`** on any deployment reachable from the internet.
  When set, every mutating API route (runner control, strategy edits, paper
  fills/budget, settings, research, `/api/real/*`) requires
  `Authorization: Bearer <secret>` (or `X-Sniper-Secret`). When unset, auth is
  skipped — acceptable only for local development. Live mode logs a startup
  warning if the secret is missing.
- **Keep exchange/private keys in environment variables**, never in the repo or
  the database. `POLYMARKET_PRIVATE_KEY` controls real funds.
- **Apply schema changes** (`npm run db:push`) after pulling — index-only
  migrations are safe and idempotent.
- Responses ship with `X-Frame-Options: DENY`, `X-Content-Type-Options:
  nosniff`, `Referrer-Policy`, and a restrictive `Permissions-Policy`
  (configured in `next.config.ts`).

## Reporting a vulnerability

Open a GitHub issue with the `security` label, or email the repository owner
directly for anything sensitive (e.g. issues that could affect funds). Please
include reproduction steps. Reports are typically triaged within a few days.
