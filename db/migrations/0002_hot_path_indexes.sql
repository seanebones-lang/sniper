-- Hot-path indexes for tables the runner and dashboards hit every few seconds.
-- audit_events grows on every cycle and is always read newest-first;
-- real_trades is polled by status (pending / needs_review) for reconciliation,
-- exposure checks, and the in-flight order guard.

CREATE INDEX IF NOT EXISTS "audit_events_created_at_idx" ON "audit_events" ("created_at");

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "audit_events_action_created_idx" ON "audit_events" ("action", "created_at");

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "real_trades_status_created_idx" ON "real_trades" ("status", "created_at");
