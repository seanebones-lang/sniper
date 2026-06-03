import { loadSystemState, persistSystemState } from '@/lib/monitoring/system-state';
import { clearPolymarketHttpMiddlewareCache } from '@/lib/clients/polymarket-http-proxy';

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
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://') && !trimmed.startsWith('socks')) {
    throw new Error('Proxy URL must start with http://, https://, or socks5://');
  }
  await persistSystemState(
    'polymarket_http_proxy',
    { url: trimmed, updatedAt: new Date().toISOString() },
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
