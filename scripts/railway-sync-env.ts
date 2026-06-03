#!/usr/bin/env npx tsx
/**
 * Push .env.local vars to the linked Railway service (never prints secret values).
 * Skips DATABASE_URL — use Railway Postgres reference instead.
 *
 * Usage: npx tsx scripts/railway-sync-env.ts [--service sniper] [--dry-run]
 */
import { readFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(ROOT, '.env.local');

const SKIP_KEYS = new Set([
  'DATABASE_URL',
  'RAILWAY_ENVIRONMENT',
  'RAILWAY_ENVIRONMENT_ID',
  'RAILWAY_ENVIRONMENT_NAME',
  'RAILWAY_PROJECT_ID',
  'RAILWAY_PROJECT_NAME',
  'RAILWAY_SERVICE_ID',
  'RAILWAY_SERVICE_NAME',
  'RAILWAY_PUBLIC_DOMAIN',
  'RAILWAY_PRIVATE_DOMAIN',
  'RAILWAY_STATIC_URL',
  'SNIPER_SKIP_GEOBLOCK_CHECK',
]);

function parseEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!SKIP_KEYS.has(key)) out[key] = val;
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const serviceIdx = args.indexOf('--service');
  const service = serviceIdx >= 0 ? args[serviceIdx + 1] : undefined;

  const vars = parseEnvFile(ENV_FILE);
  if (Object.keys(vars).length === 0) {
    console.error('No vars found in .env.local');
    process.exit(1);
  }

  const keys = Object.keys(vars).sort();
  console.log(`Syncing ${keys.length} keys from .env.local${service ? ` → service ${service}` : ''}…`);
  console.log('Keys:', keys.join(', '));

  for (const [key, value] of Object.entries(vars)) {
    if (dryRun) continue;
    const cmd = ['variable', 'set', `${key}=${value}`, '--skip-deploys'];
    if (service) cmd.push('--service', service);
    const r = spawnSync('railway', cmd, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (r.status !== 0) {
      console.error(`Failed to set ${key}:`, r.stderr || r.stdout);
      process.exit(1);
    }
  }

  if (!dryRun) {
    console.log('Done. Redeploy with: railway up --detach');
  }
}

main();
