import {
  boolean,
  decimal,
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
});

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
});

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
