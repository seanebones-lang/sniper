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

export function filterFastMovingMarkets(markets: Market[]): Market[] {
  return markets.filter((m) => assessFastMovingMarket(m).fast);
}
