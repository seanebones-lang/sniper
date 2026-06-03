/**
 * Writes derived Polymarket CLOB API creds + optional xAI key into .env.local.
 * Usage: set -a && . ./.env.local && set +a && npx tsx scripts/sync-env-credentials.ts
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  getPolymarketPrivateKey,
  getTradingClient,
} from '../lib/clients/polymarket-trading';

const ENV_PATH = join(process.cwd(), '.env.local');

function upsertEnv(lines: string[], key: string, value: string): string[] {
  const prefix = `${key}=`;
  const filtered = lines.filter((l) => !l.startsWith(prefix));
  filtered.push(`${prefix}${value}`);
  return filtered;
}

function readOptionalRelayerKey(): string | undefined {
  const fromEnv = process.env.RELAYER_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const file = process.env.RELAYER_API_KEY_FILE?.trim();
  if (file) {
    try {
      return readFileSync(file, 'utf8').trim();
    } catch {
      return undefined;
    }
  }
  const localPath = join(process.cwd(), 'data', 'relayer-api-key.txt');
  try {
    const v = readFileSync(localPath, 'utf8').trim();
    return v || undefined;
  } catch {
    return undefined;
  }
}

async function main() {
  let lines = readFileSync(ENV_PATH, 'utf8').split('\n');

  const pk = getPolymarketPrivateKey();
  if (pk) {
    const client = getTradingClient(pk);
    const creds = await client.createOrDeriveApiKey();
    lines = upsertEnv(lines, 'POLYMARKET_API_KEY', creds.key);
    lines = upsertEnv(lines, 'POLYMARKET_API_SECRET', creds.secret);
    lines = upsertEnv(lines, 'POLYMARKET_API_PASSPHRASE', creds.passphrase);
    console.log('Updated POLYMARKET_API_KEY, POLYMARKET_API_SECRET, POLYMARKET_API_PASSPHRASE');
  }

  const relayerKey = readOptionalRelayerKey();
  const clobKey = lines.find((l) => l.startsWith('POLYMARKET_API_KEY='))?.split('=')[1];
  if (relayerKey) {
    lines = upsertEnv(lines, 'RELAYER_API_KEY', relayerKey);
    console.log('Updated RELAYER_API_KEY');
  } else {
    console.log(
      'RELAYER_API_KEY unchanged — set data/relayer-api-key.txt or POLYMARKET_PRIVATE_KEY for derivation',
    );
  }

  try {
    const settings = JSON.parse(
      readFileSync(join(process.cwd(), 'data', 'user-settings.json'), 'utf8'),
    ) as { xaiApiKey?: string; enableGrokResearchAgent?: boolean };
    if (settings.xaiApiKey) {
      lines = upsertEnv(lines, 'XAI_API_KEY', settings.xaiApiKey);
      console.log('Updated XAI_API_KEY from data/user-settings.json');
    }
    if (settings.enableGrokResearchAgent) {
      lines = upsertEnv(lines, 'ENABLE_GROK_RESEARCH_AGENT', 'true');
    }
  } catch {
    // optional
  }

  if (!lines.some((l) => l.startsWith('RELAYER_API_KEY_ADDRESS='))) {
    lines = upsertEnv(
      lines,
      'RELAYER_API_KEY_ADDRESS',
      '0x3E352855801ba68C0e2FCB9657444A9A8e067874',
    );
  }

  writeFileSync(ENV_PATH, lines.join('\n').replace(/\n*$/, '\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
