import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL!;

/**
 * Reuse one connection pool across Next.js dev HMR reloads — each reload
 * re-evaluates this module, and without the global cache every reload leaks
 * another 10-connection pool until Postgres hits max_connections.
 */
type DbGlobal = typeof globalThis & { __sniperPgClient?: ReturnType<typeof postgres> };
const g = globalThis as DbGlobal;

const client = g.__sniperPgClient ?? postgres(connectionString, { max: 10 });
if (process.env.NODE_ENV !== 'production') {
  g.__sniperPgClient = client;
}

export const db = drizzle(client, { schema });

export * from './schema';
