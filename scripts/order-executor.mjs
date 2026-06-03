#!/usr/bin/env node
/**
 * Sniper — home-side order executor
 *
 * Runs on YOUR own (residential / business) connection so that Polymarket order
 * placement egresses from a normal IP instead of a cloud datacenter IP, which
 * Cloudflare bot-management challenges (the "CLOB rejected — region/WAF" you see
 * from Railway). The Railway app keeps doing ALL the thinking and risk-gating;
 * this service only places an order that has already been decided and sized.
 *
 * Because it holds the wallet key:
 *   - it binds to localhost by default — expose it only over a private tunnel
 *     (Cloudflare Tunnel or Tailscale), never a raw public port;
 *   - every request must carry the shared secret (ORDER_EXECUTOR_SECRET);
 *   - it enforces a hard per-order USD ceiling as defense in depth, so even a
 *     misbehaving/compromised caller cannot place a large order.
 *
 * Run:
 *   ORDER_EXECUTOR_SECRET=<long-random> POLYMARKET_PRIVATE_KEY=0x... \
 *     node scripts/order-executor.mjs
 *
 * Then expose it (e.g. `cloudflared tunnel --url http://localhost:8787`) and set
 * on Railway: SNIPER_REMOTE_EXECUTOR_URL=<tunnel url>, SNIPER_REMOTE_EXECUTOR_SECRET=<same secret>.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { ClobClient, Side } from '@polymarket/clob-client-v2';
import { createWalletClient, http as viemHttp } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';

const PORT = Number(process.env.ORDER_EXECUTOR_PORT ?? 8787);
const HOST = process.env.ORDER_EXECUTOR_HOST ?? '127.0.0.1';
const SECRET = process.env.ORDER_EXECUTOR_SECRET ?? '';
const PRIVATE_KEY = process.env.POLYMARKET_PRIVATE_KEY ?? '';
const MAX_USD = Math.max(0, Number(process.env.ORDER_EXECUTOR_MAX_USD ?? 5));
const CLOB_HOST = process.env.POLYMARKET_CLOB_HOST ?? 'https://clob.polymarket.com';

if (SECRET.length < 16) {
  console.error('[executor] ORDER_EXECUTOR_SECRET must be set and >= 16 chars. Refusing to start.');
  process.exit(1);
}
if (!PRIVATE_KEY.startsWith('0x')) {
  console.error('[executor] POLYMARKET_PRIVATE_KEY must be set (0x-prefixed). Refusing to start.');
  process.exit(1);
}

const account = privateKeyToAccount(PRIVATE_KEY);
const walletClient = createWalletClient({ account, chain: polygon, transport: viemHttp() });
const client = new ClobClient({ host: CLOB_HOST, chain: 137, signer: walletClient });

function safeEqual(provided, expected) {
  const a = Buffer.from(String(provided));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function send(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      return send(res, 200, { ok: true, address: account.address, maxUsd: MAX_USD });
    }

    if (req.method === 'POST' && req.url === '/place-order') {
      if (!safeEqual(req.headers['x-executor-secret'], SECRET)) {
        return send(res, 401, { success: false, error: 'unauthorized' });
      }

      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return send(res, 400, { success: false, error: 'invalid JSON body' });
      }

      const { tokenId, price, size, side } = body ?? {};
      const tickSize = typeof body?.tickSize === 'string' ? body.tickSize : '0.01';
      const negRisk = body?.negRisk === true;

      if (typeof tokenId !== 'string' || !tokenId) return send(res, 400, { success: false, error: 'tokenId required' });
      if (typeof price !== 'number' || price <= 0 || price >= 1) return send(res, 400, { success: false, error: 'price must be in (0,1)' });
      if (typeof size !== 'number' || size <= 0) return send(res, 400, { success: false, error: 'size must be > 0' });
      if (side !== 'BUY' && side !== 'SELL') return send(res, 400, { success: false, error: "side must be 'BUY' or 'SELL'" });

      const usd = price * size;
      if (MAX_USD > 0 && usd > MAX_USD + 1e-9) {
        console.warn(`[executor] REJECT ${tokenId.slice(0, 10)}… $${usd.toFixed(2)} > cap $${MAX_USD}`);
        return send(res, 422, { success: false, error: `order $${usd.toFixed(2)} exceeds executor cap $${MAX_USD}` });
      }

      console.log(`[executor] PLACE ${side} ${size} @ ${price} (${tokenId.slice(0, 10)}…) ~$${usd.toFixed(2)}`);
      try {
        await client.createOrDeriveApiKey();
        const order = await client.createAndPostOrder(
          { tokenID: tokenId, price, size, side: side === 'BUY' ? Side.BUY : Side.SELL },
          { tickSize, negRisk },
        );
        const orderId = order?.orderID || 'submitted';
        console.log(`[executor] OK orderId=${orderId}`);
        return send(res, 200, { success: true, orderId });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[executor] FAIL ${message}`);
        return send(res, 502, { success: false, error: message });
      }
    }

    return send(res, 404, { success: false, error: 'not found' });
  } catch (err) {
    return send(res, 500, { success: false, error: err instanceof Error ? err.message : 'server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[executor] listening on http://${HOST}:${PORT}  wallet=${account.address}  cap=$${MAX_USD}`);
  console.log('[executor] expose via Cloudflare Tunnel / Tailscale, then set SNIPER_REMOTE_EXECUTOR_URL + SNIPER_REMOTE_EXECUTOR_SECRET on Railway.');
});
