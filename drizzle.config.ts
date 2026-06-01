import type { Config } from 'drizzle-kit';

export default {
  schema: './lib/db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/sniper',
  },
  verbose: true,
  strict: true,
} satisfies Config;
