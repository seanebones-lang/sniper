/**
 * AI Recommendations Store
 * 
 * Keeps recent structured recommendations from the Grok Research Agent
 * so they can be viewed, acted upon, or alerted on.
 */

export interface AIRecommendation {
  timestamp: Date;
  riskMode: string;
  rawText: string;
  parsedActions: Array<{
    action: string;
    target: string;
    value?: string | number;
    reason: string;
  }>;
}

const recentRecommendations: AIRecommendation[] = [];
const MAX_RECOMMENDATIONS = 30;

export function storeRecommendations(rawText: string, riskMode: string) {
  const parsedActions = parseRecommendedActions(rawText);

  const rec: AIRecommendation = {
    timestamp: new Date(),
    riskMode,
    rawText: rawText.trim(),
    parsedActions,
  };

  recentRecommendations.unshift(rec);

  if (recentRecommendations.length > MAX_RECOMMENDATIONS) {
    recentRecommendations.pop();
  }

  return rec;
}

export function getRecentRecommendations(limit = 10): AIRecommendation[] {
  return recentRecommendations.slice(0, limit);
}

function parseRecommendedActions(text: string): AIRecommendation['parsedActions'] {
  const actions: AIRecommendation['parsedActions'] = [];

  // Look for lines that start with "- ACTION:" or similar
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.toUpperCase().startsWith('- ACTION:')) continue;

    try {
      // Example format:
      // - ACTION: pause_strategy | TARGET: threshold | REASON: consistent underperformance
      const parts = trimmed.replace(/^- ACTION:/i, '').split('|').map(p => p.trim());

      let action = '';
      let target = '';
      let value: string | number | undefined;
      let reason = '';

      for (const part of parts) {
        const [key, ...rest] = part.split(':').map(s => s.trim());
        const val = rest.join(':').trim();

        if (key.toUpperCase() === 'ACTION') action = val;
        if (key.toUpperCase() === 'TARGET') target = val;
        if (key.toUpperCase() === 'VALUE') value = isNaN(Number(val)) ? val : Number(val);
        if (key.toUpperCase() === 'REASON') reason = val;
      }

      if (action && target) {
        actions.push({ action, target, value, reason });
      }
    } catch (e) {
      // Ignore malformed lines
    }
  }

  return actions;
}
