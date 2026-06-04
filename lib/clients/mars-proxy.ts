/**
 * Mars (and similar) proxy lines: host:port:user:pass → http://user:pass@host:port
 */

const HTTP_PREFIX = /^https?:\/\//i;

/** Convert Mars `host:port:user:pass` or pass through an existing proxy URL. */
export function normalizeProxyUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (HTTP_PREFIX.test(trimmed) || trimmed.startsWith('socks')) {
    return trimmed;
  }

  const parts = trimmed.split(':');
  if (parts.length < 4) {
    throw new Error(
      'Proxy must be http(s)://… or Mars format host:port:user:pass (e.g. ultra.marsproxies.com:44443:user:pass_country-ie)',
    );
  }

  const host = parts[0];
  const port = parts[1];
  const user = parts[2];
  const pass = parts.slice(3).join(':');
  if (!host || !port || !user || !pass) {
    throw new Error('Invalid Mars proxy line — expected host:port:user:pass');
  }

  return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
}

/** Parse env / paste blob: newlines, commas, or pipes. */
export function parseProxyList(
  raw: string | undefined | null,
  options?: { dedupe?: boolean },
): string[] {
  if (!raw?.trim()) return [];
  const dedupe = options?.dedupe !== false;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const chunk of raw.split(/[\n,|]+/)) {
    const line = chunk.trim();
    if (!line) continue;
    try {
      const url = normalizeProxyUrl(line);
      if (dedupe && seen.has(url)) continue;
      if (dedupe) seen.add(url);
      out.push(url);
    } catch {
      // skip bad lines
    }
  }
  return out;
}
