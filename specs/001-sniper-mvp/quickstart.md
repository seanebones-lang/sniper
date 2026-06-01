# Quickstart — Running Sniper (Paper Mode 24/7)

1. `cp .env.example .env.local`
2. Add `DATABASE_URL` (local Postgres or Railway).
3. `npm run db:push`
4. `npm run dev`
5. Open UI → create a simple spread-scalper strategy on 2-3 high-volume short-term markets (paper only).
6. Let it run. Watch the decision log and paper PnL.
7. Deploy to Railway (add Postgres plugin, set secrets, run db:push once via shell, redeploy).

See README.md for full 48-hour soak test checklist and risk warnings.
