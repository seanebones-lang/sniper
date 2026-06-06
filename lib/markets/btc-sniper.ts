/**
 * BTC Up/Down 5m / 15m market filters for the btc-sniper strategy.
 */

import type { Market } from '../types';

const BTC_UP_DOWN_RE = /\b(bitcoin|btc)\b.*\bup or down\b|\bup or down\b.*\b(bitcoin|btc)\b/i;
const DAILY_RE = /\bup or down on\b/i;

function parseEtTimeToMinutes(h: number, m: number, ampm: string): number {
  let hour = h % 12;
  if (ampm.toUpperCase() === 'PM') hour += 12;
  return hour * 60 + m;
}

/** Parse window duration from title time range (ET). Returns null if unparseable or excluded. */
export function parseBtcWindowMinutes(question: string): 5 | 15 | null {
  if (DAILY_RE.test(question)) return null;

  const rangeMatch = question.match(
    /(\d{1,2}):(\d{2})\s*(AM|PM)\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)\s*ET/i,
  );
  if (!rangeMatch) {
    if (/\d{1,2}:\d{2}\s*(AM|PM)\s*ET/i.test(question) && !question.includes('-')) return null;
    return null;
  }

  const startMin = parseEtTimeToMinutes(
    parseInt(rangeMatch[1], 10),
    parseInt(rangeMatch[2], 10),
    rangeMatch[3],
  );
  let endMin = parseEtTimeToMinutes(
    parseInt(rangeMatch[4], 10),
    parseInt(rangeMatch[5], 10),
    rangeMatch[6],
  );
  if (endMin <= startMin) endMin += 24 * 60;

  const diff = endMin - startMin;
  if (diff === 5) return 5;
  if (diff === 15) return 15;
  return null;
}

export function isBtcUpDownMarket(market: Pick<Market, 'question' | 'btcWindowMinutes'>): boolean {
  if (market.btcWindowMinutes === 5 || market.btcWindowMinutes === 15) return true;
  if (!BTC_UP_DOWN_RE.test(market.question)) return false;
  if (DAILY_RE.test(market.question)) return false;
  return parseBtcWindowMinutes(market.question) != null;
}

export function filterBtcSniperMarkets(markets: Market[], nowMs = Date.now()): Market[] {
  return markets.filter((m) => {
    if (m.status !== 'open') return false;
    if (!isBtcUpDownMarket(m)) return false;

    const windowMin = m.btcWindowMinutes ?? parseBtcWindowMinutes(m.question);
    if (windowMin !== 5 && windowMin !== 15) return false;

    if (!m.endDate) return false;
    const endMs = new Date(m.endDate).getTime();
    if (Number.isNaN(endMs) || endMs <= nowMs) return false;

    const maxAheadMs = (windowMin + 2) * 60 * 1000;
    if (endMs - nowMs > maxAheadMs + 15 * 60 * 1000) return false;

    return true;
  });
}

export function rankBtcSniperMarkets(markets: Market[]): Market[] {
  return [...markets].sort((a, b) => {
    const endA = a.endDate ? new Date(a.endDate).getTime() : Infinity;
    const endB = b.endDate ? new Date(b.endDate).getTime() : Infinity;
    if (endA !== endB) return endA - endB;
    return (b.volume24hr ?? b.volume ?? 0) - (a.volume24hr ?? a.volume ?? 0);
  });
}

export function dedupeMarketsByToken(markets: Market[]): Market[] {
  const seen = new Set<string>();
  const out: Market[] = [];
  for (const m of markets) {
    const key = `${m.platform}:${m.externalId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

export function summarizeBtcPool(markets: Market[]): {
  poolTotal: number;
  windows5m: number;
  windows15m: number;
  parentMarkets: number;
  soonestEndDate: string | null;
} {
  const parents = new Set<string>();
  let w5 = 0;
  let w15 = 0;
  let soonest: number | null = null;

  for (const m of markets) {
    if (m.parentMarketId) parents.add(m.parentMarketId);
    const w = m.btcWindowMinutes ?? parseBtcWindowMinutes(m.question);
    if (w === 5) w5++;
    else if (w === 15) w15++;
    if (m.endDate) {
      const t = new Date(m.endDate).getTime();
      if (!Number.isNaN(t) && (soonest == null || t < soonest)) soonest = t;
    }
  }

  return {
    poolTotal: markets.length,
    windows5m: w5,
    windows15m: w15,
    parentMarkets: parents.size,
    soonestEndDate: soonest != null ? new Date(soonest).toISOString() : null,
  };
}
