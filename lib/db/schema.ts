import {
  boolean,
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const markets = pgTable('markets', {
  id: uuid('id').primaryKey().defaultRandom(),
  platform: varchar('platform', { length: 20 }).notNull(), // 'polymarket' | 'kalshi'
  externalId: varchar('external_id', { length: 120 }).notNull(),
  question: text('question').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('open'), // open, closed, resolved
  volume: decimal('volume', { precision: 18, scale: 2 }),
  liquidity: decimal('liquidity', { precision: 18, scale: 2 }),
  lastPrice: decimal('last_price', { precision: 5, scale: 4 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  platformExternalIdx: uniqueIndex('markets_platform_external_idx').on(t.platform, t.externalId),
}));

export const strategies = pgTable('strategies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  type: varchar('type', { length: 40 }).notNull(), // 'spread-scalper' | 'threshold' | 'cross-arb'
  config: jsonb('config').$type<Record<string, unknown>>().notNull(),
  isActive: boolean('is_active').notNull().default(false),
  paperOnly: boolean('paper_only').notNull().default(true),
  maxSizeUsd: decimal('max_size_usd', { precision: 12, scale: 2 }).notNull().default('100'),
  targetProfitPct: decimal('target_profit_pct', { precision: 5, scale: 2 }).notNull().default('2.5'),
  cooldownSeconds: integer('cooldown_seconds').notNull().default(300),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const signals = pgTable('signals', {
  id: uuid('id').primaryKey().defaultRandom(),
  strategyId: uuid('strategy_id').notNull().references(() => strategies.id, { onDelete: 'cascade' }),
  marketId: uuid('market_id').notNull().references(() => markets.id, { onDelete: 'cascade' }),
  action: varchar('action', { length: 10 }).notNull(), // 'BUY' | 'SELL' | 'CANCEL'
  price: decimal('price', { precision: 5, scale: 4 }).notNull(),
  size: decimal('size', { precision: 18, scale: 4 }).notNull(),
  reason: text('reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  // Performance/analytics queries scan signals by time window and by strategy.
  createdAtIdx: index('signals_created_at_idx').on(t.createdAt),
  strategyCreatedIdx: index('signals_strategy_created_idx').on(t.strategyId, t.createdAt),
}));

export const paperTrades = pgTable('paper_trades', {
  id: uuid('id').primaryKey().defaultRandom(),
  signalId: uuid('signal_id').references(() => signals.id, { onDelete: 'set null' }),
  platform: varchar('platform', { length: 20 }).notNull(),
  marketExternalId: varchar('market_external_id', { length: 120 }).notNull(),
  side: varchar('side', { length: 4 }).notNull(), // 'YES' | 'NO' or BUY/SELL normalized
  price: decimal('price', { precision: 5, scale: 4 }).notNull(),
  size: decimal('size', { precision: 18, scale: 4 }).notNull(),
  fee: decimal('fee', { precision: 12, scale: 4 }).default('0'),
  status: varchar('status', { length: 20 }).notNull().default('filled'),
  filledAt: timestamp('filled_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  filledAtIdx: index('paper_trades_filled_at_idx').on(t.filledAt),
  signalIdx: index('paper_trades_signal_id_idx').on(t.signalId),
}));

// Separate table for real trades (never mixed with paper for audit clarity)
export const realTrades = pgTable('real_trades', {
  id: uuid('id').primaryKey().defaultRandom(),
  signalId: uuid('signal_id').references(() => signals.id, { onDelete: 'set null' }),
  platform: varchar('platform', { length: 20 }).notNull(),
  marketExternalId: varchar('market_external_id', { length: 120 }).notNull(),
  side: varchar('side', { length: 4 }).notNull(),
  price: decimal('price', { precision: 5, scale: 4 }).notNull(),
  size: decimal('size', { precision: 18, scale: 4 }).notNull(),
  fee: decimal('fee', { precision: 12, scale: 4 }).default('0'),
  status: varchar('status', { length: 20 }).notNull().default('pending'), // pending, filled, rejected, cancelled
  txHash: varchar('tx_hash', { length: 120 }), // for Polymarket on-chain
  filledAt: timestamp('filled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  createdAtIdx: index('real_trades_created_at_idx').on(t.createdAt),
  signalIdx: index('real_trades_signal_id_idx').on(t.signalId),
}));

export const positions = pgTable('positions', {
  id: uuid('id').primaryKey().defaultRandom(),
  platform: varchar('platform', { length: 20 }).notNull(),
  marketId: uuid('market_id').notNull().references(() => markets.id, { onDelete: 'cascade' }),
  side: varchar('side', { length: 10 }).notNull(),
  sizeShares: decimal('size_shares', { precision: 18, scale: 4 }).notNull().default('0'),
  avgPrice: decimal('avg_price', { precision: 5, scale: 4 }).notNull(),
  unrealizedPnl: decimal('unrealized_pnl', { precision: 12, scale: 4 }).default('0'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  platformMarketIdx: uniqueIndex('positions_platform_market_idx').on(t.platform, t.marketId),
}));

export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  actor: varchar('actor', { length: 20 }).notNull().default('system'), // 'system' | 'user'
  action: varchar('action', { length: 60 }).notNull(),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/**
 * High-resolution market snapshots for research, backtesting, and feature engineering.
 * This is one of the highest-leverage tables for building a real edge.
 */
export const marketSnapshots = pgTable('market_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  platform: varchar('platform', { length: 20 }).notNull(),
  marketExternalId: varchar('market_external_id', { length: 120 }).notNull(),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  
  // Core market state
  mid: decimal('mid', { precision: 5, scale: 4 }),
  spread: decimal('spread', { precision: 5, scale: 4 }),
  lastPrice: decimal('last_price', { precision: 5, scale: 4 }),
  
  // Order book features (top levels + aggregates)
  bestBid: decimal('best_bid', { precision: 5, scale: 4 }),
  bestAsk: decimal('best_ask', { precision: 5, scale: 4 }),
  bidSizeTop: decimal('bid_size_top', { precision: 18, scale: 4 }),
  askSizeTop: decimal('ask_size_top', { precision: 18, scale: 4 }),
  totalBidDepth: decimal('total_bid_depth', { precision: 18, scale: 4 }), // top N levels
  totalAskDepth: decimal('total_ask_depth', { precision: 18, scale: 4 }),
  
  // Derived features (critical for ML / advanced strategies)
  imbalance: decimal('imbalance', { precision: 6, scale: 4 }), // (bid_depth - ask_depth) / (bid+ask)
  microPrice: decimal('micro_price', { precision: 5, scale: 4 }), // weighted mid
  pressure: decimal('pressure', { precision: 6, scale: 4 }), // custom pressure metric
  
  // Raw top levels for replay (JSON for flexibility)
  topLevels: jsonb('top_levels'), // { bids: [...], asks: [...] }
  
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  platformMarketTimeIdx: uniqueIndex('snapshots_platform_market_time_idx').on(
    t.platform, t.marketExternalId, t.timestamp
  ),
}));

/**
 * Durable system state for 24/7 real capital operation.
 * Critical safety flags (kill switch, risk mode, daily loss counters, etc.) must survive
 * restarts, deploys, and crashes. All mutations must also emit audit_events.
 */
export const systemState = pgTable('system_state', {
  key: varchar('key', { length: 80 }).primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
