/**
 * Polymarket HTTP egress: proxy (axios + fetch) + optional browser session (cf_clearance).
 */
import axios, { type AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { ProxyAgent } from 'undici';
import { getPolymarketProxyFromDb } from '@/lib/settings/polymarket-proxy';
import { getPolymarketBrowserSessionFromDb } from '@/lib/settings/polymarket-browser-session';

let appliedProxyUrl: string | null = null;
let fetchProxyAgent: ProxyAgent | undefined;
let httpsProxyAgent: HttpsProxyAgent | undefined;
let axiosMiddlewareInstalled = false;

/** Updated on every bootstrap/reload — axios interceptor reads this (not a stale closure). */
let cachedBrowserSession: { cfClearance: string; userAgent: string } | null = null;

export function clearPolymarketHttpMiddlewareCache(): void {
  appliedProxyUrl = null;
  fetchProxyAgent = undefined;
  httpsProxyAgent = undefined;
  cachedBrowserSession = null;
}

export function clearPolymarketProxyCache(): void {
  clearPolymarketHttpMiddlewareCache();
}

export function getPolymarketProxyUrlFromEnv(): string | undefined {
  const url =
    process.env.POLYMARKET_HTTP_PROXY?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    process.env.HTTP_PROXY?.trim();
  return url && url.length > 0 ? url : undefined;
}

export async function resolvePolymarketProxyUrl(): Promise<string | undefined> {
  // DB (saved via /real) wins over env — stale Railway env vars have blocked deploys before.
  const fromDb = await getPolymarketProxyFromDb();
  if (fromDb) return fromDb;
  return getPolymarketProxyUrlFromEnv();
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

function applyProxyAgents(proxyUrl: string | undefined): void {
  if (!proxyUrl) return;
  if (appliedProxyUrl === proxyUrl && httpsProxyAgent) return;
  httpsProxyAgent = new HttpsProxyAgent(proxyUrl);
  axios.defaults.httpAgent = httpsProxyAgent;
  axios.defaults.httpsAgent = httpsProxyAgent;
  axios.defaults.proxy = false;
  process.env.HTTP_PROXY = proxyUrl;
  process.env.HTTPS_PROXY = proxyUrl;
  appliedProxyUrl = proxyUrl;
}

/** Sync proxy from env only (instrumentation startup, before any CLOB import). */
export function bootstrapPolymarketHttpFromEnv(): void {
  const proxyUrl = getPolymarketProxyUrlFromEnv();
  const cf = process.env.POLYMARKET_CF_CLEARANCE?.trim();
  const ua = process.env.POLYMARKET_USER_AGENT?.trim();
  cachedBrowserSession = cf && ua ? { cfClearance: cf, userAgent: ua } : null;
  applyProxyAgents(proxyUrl);
  installAxiosMiddlewareOnce();
}

/** Re-read proxy + browser session from env/DB and reset CLOB client cache. */
export async function reloadPolymarketHttp(): Promise<void> {
  const proxyUrl = await resolvePolymarketProxyUrl();
  cachedBrowserSession = await resolveBrowserSession();
  applyProxyAgents(proxyUrl);
  installAxiosMiddlewareOnce();
  fetchProxyAgent = undefined;
  const { resetTradingClientCache } = await import('@/lib/clients/polymarket-trading');
  resetTradingClientCache();
  const parts = [proxyUrl ? 'proxy' : null, cachedBrowserSession ? 'cf_clearance' : null].filter(Boolean);
  console.log(`[Polymarket] HTTP egress reloaded (${parts.join(' + ') || 'direct'})`);
}

/** Full bootstrap: env proxy + DB proxy + browser session. */
export async function bootstrapPolymarketHttp(): Promise<void> {
  await reloadPolymarketHttp();
}

export async function ensurePolymarketProxyConfigured(): Promise<string | undefined> {
  await bootstrapPolymarketHttp();
  return appliedProxyUrl ?? (await resolvePolymarketProxyUrl());
}

export async function getPolymarketFetchInit(): Promise<
  RequestInit & { dispatcher?: ProxyAgent }
> {
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
