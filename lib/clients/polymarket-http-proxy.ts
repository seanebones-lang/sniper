/**
 * Polymarket HTTP egress: proxy (axios + fetch) + optional browser session (cf_clearance).
 */
import axios, { type AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { ProxyAgent } from 'undici';
import { getPolymarketProxyFromDb } from '@/lib/settings/polymarket-proxy';
import { getPolymarketBrowserSessionFromDb } from '@/lib/settings/polymarket-browser-session';
import { normalizeProxyUrl, parseProxyList } from '@/lib/clients/mars-proxy';

let appliedProxyUrl: string | null = null;
let fetchProxyAgent: ProxyAgent | undefined;
let httpsProxyAgent: HttpsProxyAgent<string> | undefined;
let axiosMiddlewareInstalled = false;
let proxyPool: string[] = [];
let proxyPoolIndex = 0;

/**
 * Master switch for routing Polymarket egress through the (metered) residential
 * proxy. Defaults ON so live behavior is unchanged. The runner turns it OFF for
 * paper-only cycles so a paper soak never burns proxy bandwidth — every
 * Polymarket read then goes direct. Only live order placement needs the proxy
 * to clear Polymarket's geoblock.
 */
let proxyEgressEnabled = true;

export function isPolymarketProxyEgressEnabled(): boolean {
  return proxyEgressEnabled;
}

export function setPolymarketProxyEgressEnabled(enabled: boolean): void {
  if (proxyEgressEnabled === enabled) return;
  proxyEgressEnabled = enabled;
  if (!enabled) {
    // Stop sending Polymarket traffic through the proxy: drop the agents and
    // the global axios defaults so reads fall back to direct egress.
    httpsProxyAgent = undefined;
    fetchProxyAgent = undefined;
    axios.defaults.httpAgent = undefined;
    axios.defaults.httpsAgent = undefined;
    appliedProxyUrl = null;
    console.log('[Polymarket] Proxy egress DISABLED (paper mode — direct reads)');
  } else {
    const url = proxyPool[proxyPoolIndex] ?? proxyPool[0];
    if (url) applyProxyAgents(url, true);
    else void bootstrapPolymarketHttp().catch(() => {});
    console.log('[Polymarket] Proxy egress ENABLED (live mode)');
  }
}

/** Updated on every bootstrap/reload — axios interceptor reads this (not a stale closure). */
let cachedBrowserSession: { cfClearance: string; userAgent: string } | null = null;

export function clearPolymarketHttpMiddlewareCache(): void {
  appliedProxyUrl = null;
  fetchProxyAgent = undefined;
  httpsProxyAgent = undefined;
  cachedBrowserSession = null;
  proxyPool = [];
  proxyPoolIndex = 0;
}

export function clearPolymarketProxyCache(): void {
  clearPolymarketHttpMiddlewareCache();
}

function loadProxyPoolFromEnv(): string[] {
  const multiRaw = process.env.POLYMARKET_HTTP_PROXIES?.trim();
  if (multiRaw) {
    const multi = parseProxyList(multiRaw, { dedupe: false });
    if (multi.length > 0) return multi;
  }

  const single =
    process.env.POLYMARKET_HTTP_PROXY?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    process.env.HTTP_PROXY?.trim();
  if (!single) return [];

  try {
    return [normalizeProxyUrl(single)];
  } catch {
    return [single];
  }
}

export function getPolymarketProxyUrlFromEnv(): string | undefined {
  const pool = loadProxyPoolFromEnv();
  return pool[0];
}

export function getPolymarketProxyPoolSize(): number {
  return proxyPool.length;
}

/** Default: rotate egress on each public CLOB read (books/prices) to spread Mars rate limits. */
export function isPublicProxyRotationEnabled(): boolean {
  const mode = process.env.POLYMARKET_PROXY_ROTATE?.trim().toLowerCase();
  if (mode === 'on_failure' || mode === 'sticky') return false;
  return true;
}

async function ensureProxyPoolLoaded(): Promise<string[]> {
  if (proxyPool.length === 0) {
    proxyPool = await resolveProxyPool();
  }
  return proxyPool;
}

/**
 * Round-robin + fresh TCP connection for high-volume public reads.
 * Does not reset the trading client (orders/balance stay on sticky egress until failure).
 */
export async function getNextPublicClobAxiosAgents(): Promise<{
  httpsAgent?: HttpsProxyAgent<string>;
  httpAgent?: HttpsProxyAgent<string>;
  proxy: false;
}> {
  if (!proxyEgressEnabled) return { proxy: false };
  const pool = await ensureProxyPoolLoaded();
  if (pool.length === 0) {
    return { httpsAgent: httpsProxyAgent, httpAgent: httpsProxyAgent, proxy: false };
  }

  if (isPublicProxyRotationEnabled()) {
    proxyPoolIndex = (proxyPoolIndex + 1) % pool.length;
    const url = pool[proxyPoolIndex];
    const agent = new HttpsProxyAgent(url);
    return { httpsAgent: agent, httpAgent: agent, proxy: false };
  }

  return getClobAxiosAgents();
}

async function resolveProxyPool(): Promise<string[]> {
  const fromDb = await getPolymarketProxyFromDb();
  if (fromDb) {
    try {
      return [normalizeProxyUrl(fromDb)];
    } catch {
      return [fromDb];
    }
  }
  return loadProxyPoolFromEnv();
}

export async function resolvePolymarketProxyUrl(): Promise<string | undefined> {
  const pool = await resolveProxyPool();
  if (pool.length === 0) return undefined;
  return pool[proxyPoolIndex % pool.length];
}

export async function resolveBrowserSession(): Promise<{ cfClearance: string; userAgent: string } | null> {
  const cf = process.env.POLYMARKET_CF_CLEARANCE?.trim();
  const ua = process.env.POLYMARKET_USER_AGENT?.trim();
  if (cf && ua) return { cfClearance: cf, userAgent: ua };
  const fromDb = await getPolymarketBrowserSessionFromDb();
  if (fromDb) return { cfClearance: fromDb.cfClearance, userAgent: fromDb.userAgent };
  return null;
}

function isPolymarketHost(url: string): boolean {
  return url.includes('polymarket.com') || url.includes('clob.polymarket.com');
}

function applyBrowserHeaders(config: AxiosRequestConfig, session: { cfClearance: string; userAgent: string }) {
  const headers = (config.headers ?? {}) as Record<string, string>;
  const existing = headers.Cookie ?? headers.cookie ?? '';
  const cookie = existing.includes('cf_clearance=')
    ? existing
    : `${existing ? `${existing}; ` : ''}cf_clearance=${session.cfClearance}`;
  config.headers = {
    ...headers,
    Cookie: cookie,
    'User-Agent': session.userAgent,
    Accept: headers.Accept ?? '*/*',
    Origin: headers.Origin ?? 'https://polymarket.com',
    Referer: headers.Referer ?? 'https://polymarket.com/',
  };
}

function installAxiosMiddlewareOnce(): void {
  if (axiosMiddlewareInstalled) return;
  axios.interceptors.request.use((config) => {
    const url = String(config.url ?? config.baseURL ?? '');
    if (httpsProxyAgent) {
      config.httpAgent = httpsProxyAgent;
      config.httpsAgent = httpsProxyAgent;
      config.proxy = false;
    }
    if (cachedBrowserSession && isPolymarketHost(url)) {
      applyBrowserHeaders(config, cachedBrowserSession);
    }
    return config;
  });
  axiosMiddlewareInstalled = true;
}

function applyProxyAgents(proxyUrl: string | undefined, forceNewConnection = false): void {
  if (!proxyEgressEnabled) return;
  if (!proxyUrl) return;
  if (!forceNewConnection && appliedProxyUrl === proxyUrl && httpsProxyAgent) return;
  httpsProxyAgent = new HttpsProxyAgent(proxyUrl);
  axios.defaults.httpAgent = httpsProxyAgent;
  axios.defaults.httpsAgent = httpsProxyAgent;
  axios.defaults.proxy = false;
  // Do not set HTTP_PROXY/HTTPS_PROXY — axios may skip CONNECT tunneling (400 plain HTTP to HTTPS port).
  appliedProxyUrl = proxyUrl;
  if (forceNewConnection) {
    fetchProxyAgent = undefined;
  }
}

/**
 * On CLOB 504/timeout, advance pool index and open a fresh proxy connection
 * (Mars rotates exit IP per connection even when credentials repeat).
 */
export async function rotatePolymarketProxy(reason?: string): Promise<string | undefined> {
  const pool = await ensureProxyPoolLoaded();
  if (pool.length === 0) return undefined;

  if (pool.length > 1) {
    proxyPoolIndex = (proxyPoolIndex + 1) % pool.length;
  }

  const next = pool[proxyPoolIndex];
  applyProxyAgents(next, true);
  fetchProxyAgent = undefined;

  if (reason) {
    console.warn(
      `[Polymarket] Proxy rotate → slot ${proxyPoolIndex + 1}/${proxyPool.length}${reason ? ` (${reason})` : ''}`,
    );
  }

  const { resetTradingClientCache } = await import('@/lib/clients/polymarket-trading');
  resetTradingClientCache();
  return next;
}

/** Sync proxy from env only (instrumentation startup, before any CLOB import). */
export function bootstrapPolymarketHttpFromEnv(): void {
  proxyPool = loadProxyPoolFromEnv();
  proxyPoolIndex = 0;
  const proxyUrl = proxyPool[0];
  const cf = process.env.POLYMARKET_CF_CLEARANCE?.trim();
  const ua = process.env.POLYMARKET_USER_AGENT?.trim();
  cachedBrowserSession = cf && ua ? { cfClearance: cf, userAgent: ua } : null;
  applyProxyAgents(proxyUrl);
  installAxiosMiddlewareOnce();
}

/** Re-read proxy + browser session from env/DB; reset CLOB client only when egress changed. */
export async function reloadPolymarketHttp(): Promise<void> {
  const pool = await resolveProxyPool();
  proxyPool = pool;
  proxyPoolIndex = 0;
  const proxyUrl = pool[0];
  const session = await resolveBrowserSession();
  const proxyChanged = proxyUrl !== appliedProxyUrl;
  const sessionChanged =
    (session?.cfClearance ?? null) !== (cachedBrowserSession?.cfClearance ?? null) ||
    (session?.userAgent ?? null) !== (cachedBrowserSession?.userAgent ?? null);

  cachedBrowserSession = session;
  applyProxyAgents(proxyUrl);
  installAxiosMiddlewareOnce();
  if (proxyChanged) {
    fetchProxyAgent = undefined;
  }
  if (proxyChanged || sessionChanged) {
    const { resetTradingClientCache } = await import('@/lib/clients/polymarket-trading');
    resetTradingClientCache();
  }
  const parts = [
    proxyUrl ? (pool.length > 1 ? `proxy×${pool.length}` : 'proxy') : null,
    cachedBrowserSession ? 'cf_clearance' : null,
  ].filter(Boolean);
  if (proxyChanged || sessionChanged) {
    console.log(`[Polymarket] HTTP egress reloaded (${parts.join(' + ') || 'direct'})`);
  }
}

/** Full bootstrap: env proxy + DB proxy + browser session. */
export async function bootstrapPolymarketHttp(): Promise<void> {
  await reloadPolymarketHttp();
}

export function getClobAxiosAgents(): {
  httpsAgent?: HttpsProxyAgent<string>;
  httpAgent?: HttpsProxyAgent<string>;
  proxy: false;
} {
  if (!proxyEgressEnabled) return { proxy: false };
  return { httpsAgent: httpsProxyAgent, httpAgent: httpsProxyAgent, proxy: false };
}

let egressBootstrapped = false;

/** Idempotent — safe to call before orders; skips full reload when already configured. */
export async function ensurePolymarketProxyConfigured(): Promise<string | undefined> {
  if (egressBootstrapped && (appliedProxyUrl || loadProxyPoolFromEnv().length === 0)) {
    return appliedProxyUrl ?? (await resolvePolymarketProxyUrl());
  }
  await bootstrapPolymarketHttp();
  egressBootstrapped = true;
  return appliedProxyUrl ?? (await resolvePolymarketProxyUrl());
}

export async function getPolymarketFetchInit(): Promise<
  RequestInit & { dispatcher?: ProxyAgent }
> {
  if (!proxyEgressEnabled) return {};
  const proxyUrl = await resolvePolymarketProxyUrl();
  const session = await resolveBrowserSession();
  cachedBrowserSession = session;
  const init: RequestInit & { dispatcher?: ProxyAgent } = {};

  if (proxyUrl) {
    if (!fetchProxyAgent || appliedProxyUrl !== proxyUrl) {
      fetchProxyAgent = new ProxyAgent(proxyUrl);
      appliedProxyUrl = proxyUrl;
    }
    init.dispatcher = fetchProxyAgent;
  }

  if (session) {
    init.headers = {
      'User-Agent': session.userAgent,
      Cookie: `cf_clearance=${session.cfClearance}`,
      Accept: '*/*',
      Origin: 'https://polymarket.com',
      Referer: 'https://polymarket.com/',
    };
  }

  return init;
}
