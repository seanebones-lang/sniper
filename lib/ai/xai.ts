import { createXai } from '@ai-sdk/xai';
import { getXaiApiKey } from '@/lib/settings/keys';

export async function getXaiModel(modelId = 'grok-4') {
  const apiKey = await getXaiApiKey();
  if (!apiKey) {
    throw new Error('XAI API key not configured. Add it in Settings or set XAI_API_KEY in .env.local');
  }
  return createXai({ apiKey })(modelId);
}
