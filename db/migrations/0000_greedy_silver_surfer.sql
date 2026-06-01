CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" varchar(20) DEFAULT 'system' NOT NULL,
	"action" varchar(60) NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" varchar(20) NOT NULL,
	"market_external_id" varchar(120) NOT NULL,
	"timestamp" timestamp with time zone NOT NULL,
	"mid" numeric(5, 4),
	"spread" numeric(5, 4),
	"last_price" numeric(5, 4),
	"best_bid" numeric(5, 4),
	"best_ask" numeric(5, 4),
	"bid_size_top" numeric(18, 4),
	"ask_size_top" numeric(18, 4),
	"total_bid_depth" numeric(18, 4),
	"total_ask_depth" numeric(18, 4),
	"imbalance" numeric(6, 4),
	"micro_price" numeric(5, 4),
	"pressure" numeric(6, 4),
	"top_levels" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" varchar(20) NOT NULL,
	"external_id" varchar(120) NOT NULL,
	"question" text NOT NULL,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"volume" numeric(18, 2),
	"liquidity" numeric(18, 2),
	"last_price" numeric(5, 4),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" uuid,
	"platform" varchar(20) NOT NULL,
	"market_external_id" varchar(120) NOT NULL,
	"side" varchar(4) NOT NULL,
	"price" numeric(5, 4) NOT NULL,
	"size" numeric(18, 4) NOT NULL,
	"fee" numeric(12, 4) DEFAULT '0',
	"status" varchar(20) DEFAULT 'filled' NOT NULL,
	"filled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" varchar(20) NOT NULL,
	"market_id" uuid NOT NULL,
	"side" varchar(10) NOT NULL,
	"size_shares" numeric(18, 4) DEFAULT '0' NOT NULL,
	"avg_price" numeric(5, 4) NOT NULL,
	"unrealized_pnl" numeric(12, 4) DEFAULT '0',
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "real_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" uuid,
	"platform" varchar(20) NOT NULL,
	"market_external_id" varchar(120) NOT NULL,
	"side" varchar(4) NOT NULL,
	"price" numeric(5, 4) NOT NULL,
	"size" numeric(18, 4) NOT NULL,
	"fee" numeric(12, 4) DEFAULT '0',
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"tx_hash" varchar(120),
	"filled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_id" uuid NOT NULL,
	"market_id" uuid NOT NULL,
	"action" varchar(10) NOT NULL,
	"price" numeric(5, 4) NOT NULL,
	"size" numeric(18, 4) NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"type" varchar(40) NOT NULL,
	"config" jsonb NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"paper_only" boolean DEFAULT true NOT NULL,
	"max_size_usd" numeric(12, 2) DEFAULT '100' NOT NULL,
	"target_profit_pct" numeric(5, 2) DEFAULT '2.5' NOT NULL,
	"cooldown_seconds" integer DEFAULT 300 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paper_trades" ADD CONSTRAINT "paper_trades_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_trades" ADD CONSTRAINT "real_trades_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "snapshots_platform_market_time_idx" ON "market_snapshots" USING btree ("platform","market_external_id","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "markets_platform_external_idx" ON "markets" USING btree ("platform","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "positions_platform_market_idx" ON "positions" USING btree ("platform","market_id");