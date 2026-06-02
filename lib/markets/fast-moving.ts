/**
 * Detect live / fast-moving markets suitable for quick in-and-out flips
 * (sports in-play, short crypto windows, high-velocity event markets).
 */

import type { Market } from '../types';

export type FastMovingKind =
  | 'sports-live'
  | 'sports'
  | 'short-crypto'
  | 'short-event'
  | 'high-volume';

export interface FastMovingAssessment {
  fast: boolean;
  kind: FastMovingKind | 'none';
  score: number;
  reasons: string[];
}

const SPORTS_LIVE_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(live|in[- ]?play|currently|right now|tonight|today)\b/i, label: 'live/in-play' },
  { re: /\b(set \d|quarter|inning|half|period|overtime|ot\b|halftime)\b/i, label: 'in-game period' },
  { re: /\bvs\.?\b|\bbeat\b|\bwin(s)?\b.*\b(game|match|series)\b/i, label: 'matchup' },
];

const SPORTS_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(nba|nfl|mlb|nhl|mls|wnba|ncaa|premier league|champions league|world cup|super bowl)\b/i, label: 'major league' },
  { re: /\b(tennis|wimbledon|us open|australian open|roland garros|atp|wta)\b/i, label: 'tennis' },
  { re: /\b(baseball|basketball|football|hockey|soccer|cricket|rugby|golf|ufc|mma|boxing)\b/i, label: 'sport' },
  { re: /\b(pitcher|batter|touchdown|home run|three[- ]pointer|free throw|serve|ace)\b/i, label: 'play-by-play' },
];

const SHORT_CRYPTO_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(5m|15m|30m|1h|hour|minute)\b.*\b(bitcoin|btc|ethereum|eth|sol|crypto|price)\b/i, label: 'short crypto window' },
  { re: /\b(bitcoin|btc|ethereum|eth|solana|sol)\b.*\b(5m|15m|30m|1h|hour|minute|above|below)\b/i, label: 'short crypto window' },
];

const SHORT_EVENT_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(next|within|before|by)\b.*\b(minute|hour|hours|today|tonight)\b/i, label: 'near-term event' },
  { re: /\b(resolves?|ends?)\b.*\b(today|tonight|hour|minute)\b/i, label: 'imminent resolution' },
];

/** Long-dated outrights — bad quick-flip targets (World Cup winner, 2028 election, etc.) */
const LONG_DATED_OUTRIGHT_PATTERNS: RegExp[] = [
  /\bwin the \d{4}\b/i,
  /\bwin the (?:\d{4} )?(?:fifa )?world cup\b/i,
  /\bbefore (?:the )?(?:\d{4}|202[6-9]|203\d)\b/i,
  /\b(?:president|election|nominee|champion)\b.*\b(?:202[6-9]|203\d)\b/i,
  /\b(?:202[7-9]|203\d)\b.*\b(?:world cup|election|president|championship)\b/i,
];

const LIVE_SPORTS_KEYWORDS =
  /\b(tennis|atp|wta|open:|championships:|grand prix|set \d|set handicap|match o\/u| vs\.? )\b/i;

/** Quick-flip only trades markets resolving within this window (hours). */
export const QUICK_FLIP_MAX_RESOLUTION_HOURS = 3;

function matchPatterns(
  text: string,
  patterns: Array<{ re: RegExp; label: string }>,
): string[] {
  const hits: string[] = [];
  for (const { re, label } of patterns) {
    if (re.test(text)) hits.push(label);
  }
  return hits;
}

/** Hours until resolution; null if endDate missing or invalid. Negative if already past. */
export function hoursUntilResolution(market: Market, nowMs = Date.now()): number | null {
  if (!market.endDate) return null;
  const endMs = new Date(market.endDate).getTime();
  if (Number.isNaN(endMs)) return null;
  return (endMs - nowMs) / 3600000;
}

/** True when market end/resolution is in the future but within N hours. */
export function resolvesWithinHours(market: Market, hours: number): boolean {
  const remaining = hoursUntilResolution(market);
  if (remaining == null) return false;
  return remaining > 0 && remaining <= hours;
}

/** True when market resolves on the local calendar day (today). */
export function resolvesToday(market: Market, now = new Date()): boolean {
  if (!market.endDate) return false;
  const end = new Date(market.endDate);
  if (Number.isNaN(end.getTime()) || end.getTime() <= now.getTime()) return false;
  return end.toDateString() === now.toDateString();
}

/** Long-dated futures misclassified as "sports" (e.g. World Cup 2026 winner). */
export function isLongDatedOutright(market: Market): boolean {
  const q = market.question;
  const hasLiveCue =
    /\b(live|in[- ]?play|set \d|quarter|inning|half|period|tonight|today)\b/i.test(q) ||
    LIVE_SPORTS_KEYWORDS.test(q);

  if (hasLiveCue) return false;

  if (LONG_DATED_OUTRIGHT_PATTERNS.some((re) => re.test(q))) return true;

  if (market.endDate) {
    const endMs = new Date(market.endDate).getTime();
    if (!Number.isNaN(endMs) && endMs - Date.now() > 7 * 24 * 3600 * 1000) {
      return true;
    }
  }

  return false;
}

/**
 * Quick-flip eligibility: resolves within QUICK_FLIP_MAX_RESOLUTION_HOURS only.
 * Title heuristics are ignored — endDate from the exchange is the gate.
 */
export function isQuickFlipCandidate(market: Market): boolean {
  if (!market.endDate) return false;
  if (isLongDatedOutright(market)) return false;
  return resolvesWithinHours(market, QUICK_FLIP_MAX_RESOLUTION_HOURS);
}

/**
 * Score how suitable a market is for rapid buy-in / sell-out flips.
 */
export function assessFastMovingMarket(market: Market): FastMovingAssessment {
  const q = market.question;
  const reasons: string[] = [];
  let score = 0;
  let kind: FastMovingKind | 'none' = 'none';

  const liveHits = matchPatterns(q, SPORTS_LIVE_PATTERNS);
  const sportHits = matchPatterns(q, SPORTS_PATTERNS);
  const cryptoHits = matchPatterns(q, SHORT_CRYPTO_PATTERNS);
  const eventHits = matchPatterns(q, SHORT_EVENT_PATTERNS);

  if (liveHits.length) {
    score += 40 + liveHits.length * 8;
    kind = 'sports-live';
    reasons.push(...liveHits);
  }

  if (sportHits.length) {
    score += 25 + sportHits.length * 6;
    if (kind === 'none') kind = 'sports';
    reasons.push(...sportHits);
  }

  if (cryptoHits.length) {
    score += 30 + cryptoHits.length * 5;
    if (kind === 'none') kind = 'short-crypto';
    reasons.push(...cryptoHits);
  }

  if (eventHits.length) {
    score += 15 + eventHits.length * 4;
    if (kind === 'none') kind = 'short-event';
    reasons.push(...eventHits);
  }

  const volume = market.volume ?? 0;
  const liquidity = market.liquidity ?? 0;

  if (volume >= 50_000) {
    score += 12;
    if (kind === 'none') kind = 'high-volume';
    reasons.push('high volume');
  } else if (volume >= 10_000) {
    score += 6;
    reasons.push('moderate volume');
  }

  if (liquidity >= 5_000) {
    score += 8;
    reasons.push('liquid book');
  }

  if (isLongDatedOutright(market)) {
    return { fast: false, kind: 'none', score: 0, reasons: ['long-dated outright'] };
  }

  const fast = score >= 30;

  return {
    fast,
    kind: fast ? kind : 'none',
    score,
    reasons: [...new Set(reasons)],
  };
}

export function isFastMovingMarket(market: Market): FastMovingAssessment {
  return assessFastMovingMarket(market);
}

/**
 * Prefer fast-moving markets at the top of the evaluation queue.
 */
export function rankFastMovingMarkets(markets: Market[]): Market[] {
  return [...markets].sort((a, b) => {
    const sa = assessFastMovingMarket(a).score;
    const sb = assessFastMovingMarket(b).score;
    if (sb !== sa) return sb - sa;
    return (b.volume ?? 0) - (a.volume ?? 0);
  });
}

/** Highest entry price that still allows a full target multiple before the 0.99 cap. */
export function maxQuickFlipEntryPrice(mult = 2.5): number {
  return 0.99 / mult;
}

export function rankQuickFlipMarkets(markets: Market[]): Market[] {
  const maxEntry = maxQuickFlipEntryPrice();

  return [...markets]
    .filter(isQuickFlipCandidate)
    .sort((a, b) => {
      const ha = hoursUntilResolution(a) ?? 999;
      const hb = hoursUntilResolution(b) ?? 999;
      if (ha !== hb) return ha - hb;

      const sa = assessFastMovingMarket(a).score;
      const sb = assessFastMovingMarket(b).score;
      if (sb !== sa) return sb - sa;

      const pa = a.lastPrice ?? 0.5;
      const pb = b.lastPrice ?? 0.5;
      const aFlip = pa > 0 && pa <= maxEntry ? 0 : 1;
      const bFlip = pb > 0 && pb <= maxEntry ? 0 : 1;
      if (aFlip !== bFlip) return aFlip - bFlip;
      if (pa !== pb) return pa - pb;

      return (b.volume24hr ?? b.volume ?? 0) - (a.volume24hr ?? a.volume ?? 0);
    });
}

export function filterQuickFlipMarkets(markets: Market[]): Market[] {
  return markets.filter(isQuickFlipCandidate);
}

export function filterFastMovingMarkets(markets: Market[]): Market[] {
  return markets.filter((m) => assessFastMovingMarket(m).fast);
}
