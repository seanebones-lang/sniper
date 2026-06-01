/**
 * Market Categorization System
 * 
 * Used by the PortfolioRiskManager for category-level exposure limits.
 * This is a foundational piece for professional risk management.
 */

export type MarketCategory = 'crypto' | 'politics' | 'sports' | 'economics' | 'entertainment' | 'other';

export interface CategorizedMarket {
  externalId: string;
  platform: string;
  category: MarketCategory;
  subcategory?: string; // e.g. "btc-15m", "us-election-2028"
}

/**
 * Simple but effective categorization.
 * In a more advanced system this would use embeddings, LLM classification, or manual tagging.
 */
export function categorizeMarket(question: string, platform: string, externalId: string): CategorizedMarket {
  const q = question.toLowerCase();

  // Crypto detection (very common for short-term sniping)
  if (q.includes('bitcoin') || q.includes('btc') || q.includes('ethereum') || q.includes('eth') || 
      q.includes('crypto') || q.includes('solana') || q.includes('price above') && (q.includes('$') || q.includes('k'))) {
    return {
      externalId,
      platform,
      category: 'crypto',
      subcategory: q.includes('bitcoin') || q.includes('btc') ? 'btc' : 
                   q.includes('ethereum') || q.includes('eth') ? 'eth' : 'other-crypto'
    };
  }

  // Politics / Elections
  if (q.includes('election') || q.includes('president') || q.includes('trump') || q.includes('harris') || 
      q.includes('senate') || q.includes('congress') || q.includes('prime minister')) {
    return {
      externalId,
      platform,
      category: 'politics',
      subcategory: 'election'
    };
  }

  // Sports
  if (q.includes('nfl') || q.includes('nba') || q.includes('mlb') || q.includes('premier league') || 
      q.includes('world cup') || q.includes('super bowl') || q.includes('wins') && (q.includes('game') || q.includes('match'))) {
    return {
      externalId,
      platform,
      category: 'sports'
    };
  }

  // Economics / Fed / Rates
  if (q.includes('fed') || q.includes('interest rate') || q.includes('inflation') || q.includes('recession') || 
      q.includes('gdp') || q.includes('unemployment')) {
    return {
      externalId,
      platform,
      category: 'economics'
    };
  }

  return {
    externalId,
    platform,
    category: 'other'
  };
}

/**
 * Get category limits (can be made dynamic later based on volatility regime, etc.)
 */
export function getCategoryLimits(): Record<MarketCategory, number> {
  return {
    crypto: 650,
    politics: 900,
    sports: 450,
    economics: 400,
    entertainment: 300,
    other: 500,
  };
}
