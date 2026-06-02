import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';

interface UserSettings {
  xaiApiKey?: string;
  enableGrokResearchAgent?: boolean;
}

const SETTINGS_PATH = path.join(process.cwd(), 'data', 'user-settings.json');

let cachedSettings: UserSettings | null = null;

async function loadSettingsFile(): Promise<UserSettings> {
  if (cachedSettings) return cachedSettings;

  try {
    const raw = await readFile(SETTINGS_PATH, 'utf-8');
    cachedSettings = JSON.parse(raw) as UserSettings;
    return cachedSettings;
  } catch {
    cachedSettings = {};
    return cachedSettings;
  }
}

async function saveSettingsFile(settings: UserSettings): Promise<void> {
  await mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
  await writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
  cachedSettings = settings;
}

export async function getXaiApiKey(): Promise<string | null> {
  if (process.env.XAI_API_KEY) return process.env.XAI_API_KEY;
  const settings = await loadSettingsFile();
  return settings.xaiApiKey ?? null;
}

export async function setXaiApiKey(key: string): Promise<void> {
  const settings = await loadSettingsFile();
  settings.xaiApiKey = key.trim();
  await saveSettingsFile(settings);
}

export async function clearXaiApiKey(): Promise<void> {
  const settings = await loadSettingsFile();
  delete settings.xaiApiKey;
  await saveSettingsFile(settings);
}

export async function getGrokResearchEnabled(): Promise<boolean> {
  if (process.env.ENABLE_GROK_RESEARCH_AGENT === 'true') return true;
  const settings = await loadSettingsFile();
  return settings.enableGrokResearchAgent === true;
}

export async function setGrokResearchEnabled(enabled: boolean): Promise<void> {
  const settings = await loadSettingsFile();
  settings.enableGrokResearchAgent = enabled;
  await saveSettingsFile(settings);
}

export async function getSettingsStatus() {
  const envKey = !!process.env.XAI_API_KEY;
  const settings = await loadSettingsFile();
  const settingsKey = !!settings.xaiApiKey;
  const key = envKey ? process.env.XAI_API_KEY! : settings.xaiApiKey;

  return {
    xaiConfigured: envKey || settingsKey,
    xaiSource: envKey ? 'env' as const : settingsKey ? 'settings' as const : null,
    xaiMasked: key ? `${key.slice(0, 6)}…${key.slice(-4)}` : null,
    grokResearchEnabled: envKey
      ? process.env.ENABLE_GROK_RESEARCH_AGENT === 'true'
      : settings.enableGrokResearchAgent === true,
    canEditXaiKey: !envKey,
  };
}
