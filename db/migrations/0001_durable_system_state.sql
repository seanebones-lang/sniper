-- Durable system state for 24/7 real capital safety
-- Critical flags (kill switch, risk mode, daily loss, etc.) must survive restarts

CREATE TABLE IF NOT EXISTS "system_state" (
	"key" varchar(80) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with timezone DEFAULT now() NOT NULL
);

--> statement-breakpoint

-- Helpful index for common lookups (though PK is sufficient)
CREATE INDEX IF NOT EXISTS "system_state_key_idx" ON "system_state" ("key");