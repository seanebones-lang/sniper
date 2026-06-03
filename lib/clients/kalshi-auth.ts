/**
 * Kalshi API key signing (REST + WebSocket handshake).
 * @see https://docs.kalshi.com/getting_started/quick_start_websockets
 */

import * as crypto from 'crypto';

export interface KalshiCredentials {
  accessKey: string;
  privateKeyPem: string;
}

export function normalizeKalshiPrivateKey(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes('\\n')) {
    return trimmed.replace(/\\n/g, '\n');
  }
  return trimmed;
}

/** Returns credentials when env is configured; otherwise null (public REST only). */
export function getKalshiCredentialsOptional(): KalshiCredentials | null {
  const accessKey = process.env.KALSHI_ACCESS_KEY?.trim();
  const privateKeyRaw = process.env.KALSHI_RSA_PRIVATE_KEY?.trim();
  if (!accessKey || !privateKeyRaw) return null;

  return {
    accessKey,
    privateKeyPem: normalizeKalshiPrivateKey(privateKeyRaw),
  };
}

/** Sign `timestamp + method + path` with RSA-PSS SHA-256 (Kalshi v2). */
export function signKalshiRequest(
  privateKeyPem: string,
  timestampMs: string,
  method: string,
  path: string,
): string {
  const pathOnly = path.split('?')[0];
  const message = `${timestampMs}${method}${pathOnly}`;
  const signature = crypto.sign('sha256', Buffer.from(message, 'utf8'), {
    key: privateKeyPem,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: 32,
  });
  return signature.toString('base64');
}

export const KALSHI_WS_SIGN_PATH = '/trade-api/ws/v2';

export function createKalshiWsAuthHeaders(creds: KalshiCredentials): Record<string, string> {
  const timestamp = Date.now().toString();
  const signature = signKalshiRequest(
    creds.privateKeyPem,
    timestamp,
    'GET',
    KALSHI_WS_SIGN_PATH,
  );

  return {
    'KALSHI-ACCESS-KEY': creds.accessKey,
    'KALSHI-ACCESS-TIMESTAMP': timestamp,
    'KALSHI-ACCESS-SIGNATURE': signature,
  };
}
