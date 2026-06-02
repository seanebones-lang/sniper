#!/usr/bin/env node
/**
 * API smoke tests — fast checks that core endpoints respond correctly.
 * Usage: node scripts/smoke-test.mjs [baseUrl]
 */

const BASE = process.argv[2] ?? process.env.SMOKE_BASE_URL ?? 'http://localhost:3001';

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`✗ ${name}: ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function post(path, data) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function main() {
  console.log(`Smoke testing ${BASE}\n`);

  const pages = ['/', '/dashboard', '/markets', '/strategies', '/backtest', '/settings', '/health'];
  for (const path of pages) {
    await check(`GET ${path}`, async () => {
      const res = await fetch(`${BASE}${path}`);
      assert(res.ok, `status ${res.status}`);
    });
  }

  await check('GET /api/health', async () => {
    const { res, body } = await get('/api/health');
    assert(res.ok, `status ${res.status}`);
    assert(body.risk?.mode, 'missing risk.mode');
  });

  await check('GET /api/markets', async () => {
    const { res, body } = await get('/api/markets');
    assert(res.ok, `status ${res.status}`);
    assert(Array.isArray(body.markets), 'markets not array');
    assert(body.markets.length > 0, 'no markets returned');
    assert(body.markets[0].lastPrice != null, 'lastPrice missing — Gamma parse regression');
    assert(body.markets[0].externalId?.length > 10, 'externalId should be CLOB token, not market id');
  });

  await check('GET /api/settings', async () => {
    const { res, body } = await get('/api/settings');
    assert(res.ok, `status ${res.status}`);
    assert('xaiConfigured' in body, 'missing xaiConfigured');
  });

  await check('GET /api/runner', async () => {
    const { res, body } = await get('/api/runner');
    assert(res.ok, `status ${res.status}`);
    assert('running' in body, 'missing running');
  });

  let token;
  await check('GET /api/markets/orderbook', async () => {
    const { body: marketsBody } = await get('/api/markets');
    token = marketsBody.markets[0].externalId;
    const { res, body } = await get(`/api/markets/orderbook?platform=polymarket&id=${encodeURIComponent(token)}`);
    assert(res.ok, `status ${res.status}`);
    assert(body.mid != null || body.bids?.length > 0, 'empty orderbook');
    assert(body.market?.question, 'missing market metadata on orderbook');
    // Regression: unsorted books used to produce mid ≈ 0.5 on low-price markets
    if (body.mid != null && body.mid < 0.05) {
      assert(body.mid < 0.1, `orderbook mid looks wrong (got ${body.mid}) — sort regression`);
    }
  });

  await check('POST /api/paper/fill', async () => {
    const { res, body } = await post('/api/paper/fill', {
      platform: 'polymarket',
      marketExternalId: token,
      side: 'BUY',
      price: 0.15,
      size: 10,
    });
    assert(res.ok, `status ${res.status}: ${body.error ?? ''}`);
    assert(body.fill?.id, 'no fill returned');
    assert(body.persistedId, 'not persisted to DB');
  });

  await check('POST /api/research/replay', async () => {
    const { res, body } = await post('/api/research/replay', {
      platform: 'polymarket',
      marketExternalId: token,
      strategyType: 'spread-scalper',
      hours: 24,
    });
    assert(res.ok, `status ${res.status}: ${body.error ?? ''}`);
    assert('snapshotCount' in body, 'missing snapshotCount');
  });

  console.log(`\n---\nPassed: ${passed}  Failed: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
