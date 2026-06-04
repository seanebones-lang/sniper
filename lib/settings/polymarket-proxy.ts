import { loadSystemState, persistSystemState } from '@/lib/monitoring/system-state';
import { clearPolymarketHttpMiddlewareCache } from '@/lib/clients/polymarket-http-proxy';
import { normalizeProxyUrl } from '@/lib/clients/mars-proxy';

export interface PolymarketProxyState {
  url: string;
  updatedAt: string;
}

export async function getPolymarketProxyFromDb(): Promise<string | null> {
  const row = await loadSystemState<PolymarketProxyState>('polymarket_http_proxy');
  const url = row?.url?.trim();
  return url && url.length > 0 ? url : null;
}

export async function setPolymarketProxyUrl(url: string): Promise<void> {
  const trimmed = url.trim();
  const normalized = normalizeProxyUrl(trimmed);
  await persistSystemState(
    'polymarket_http_proxy',
    { url: normalized, updatedAt: new Date().toISOString() },
    'user set Polymarket egress proxy',
  );
  clearPolymarketHttpMiddlewareCache();
}

export async function clearPolymarketProxyUrl(): Promise<void> {
  await persistSystemState('polymarket_http_proxy', { url: '', updatedAt: new Date().toISOString() });
  clearPolymarketHttpMiddlewareCache();
}

export function maskProxyUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    if (u.username) u.username = '***';
    return u.toString();
  } catch {
    return '(invalid URL)';
  }
}
