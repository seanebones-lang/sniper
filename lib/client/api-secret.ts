/** Client-side bearer token for mutating API routes when SNIPER_API_SECRET is set. */
const STORAGE_KEY = 'sniper_api_secret';

export function getStoredApiSecret(): string {
  if (typeof window === 'undefined') return '';
  return sessionStorage.getItem(STORAGE_KEY)?.trim() ?? '';
}

export function setStoredApiSecret(secret: string): void {
  if (typeof window === 'undefined') return;
  const v = secret.trim();
  if (v) sessionStorage.setItem(STORAGE_KEY, v);
  else sessionStorage.removeItem(STORAGE_KEY);
}

export function apiAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const secret = getStoredApiSecret();
  if (secret) headers.Authorization = `Bearer ${secret}`;
  return headers;
}

export function jsonAuthHeaders(): Record<string, string> {
  return apiAuthHeaders({ 'Content-Type': 'application/json' });
}
