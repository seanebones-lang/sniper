import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';

export interface PaperBudgetSettings {
  paperBudgetUsd: number;
  maxExposureUsd: number;
  maxDailyLossUsd: number;
}

const DEFAULTS: PaperBudgetSettings = {
  paperBudgetUsd: 10_000,
  maxExposureUsd: 2_000,
  maxDailyLossUsd: 150,
};

const SETTINGS_PATH = path.join(process.cwd(), 'data', 'user-settings.json');

interface UserSettingsFile {
  paperBudgetUsd?: number;
  maxExposureUsd?: number;
  maxDailyLossUsd?: number;
  xaiApiKey?: string;
  enableGrokResearchAgent?: boolean;
}

let cached: PaperBudgetSettings | null = null;

async function readFileSettings(): Promise<UserSettingsFile> {
  try {
    const raw = await readFile(SETTINGS_PATH, 'utf-8');
    return JSON.parse(raw) as UserSettingsFile;
  } catch {
    return {};
  }
}

export async function getPaperBudgetSettings(): Promise<PaperBudgetSettings> {
  if (cached) return cached;

  const file = await readFileSettings();

  cached = {
    paperBudgetUsd: file.paperBudgetUsd ?? DEFAULTS.paperBudgetUsd,
    maxExposureUsd: file.maxExposureUsd ?? DEFAULTS.maxExposureUsd,
    maxDailyLossUsd: file.maxDailyLossUsd ?? DEFAULTS.maxDailyLossUsd,
  };

  return cached;
}

export async function setPaperBudgetSettings(partial: Partial<PaperBudgetSettings>): Promise<PaperBudgetSettings> {
  const file = await readFileSettings();

  if (partial.paperBudgetUsd != null) file.paperBudgetUsd = partial.paperBudgetUsd;
  if (partial.maxExposureUsd != null) file.maxExposureUsd = partial.maxExposureUsd;
  if (partial.maxDailyLossUsd != null) file.maxDailyLossUsd = partial.maxDailyLossUsd;

  await mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
  await writeFile(SETTINGS_PATH, JSON.stringify(file, null, 2), 'utf-8');

  cached = {
    paperBudgetUsd: file.paperBudgetUsd ?? DEFAULTS.paperBudgetUsd,
    maxExposureUsd: file.maxExposureUsd ?? DEFAULTS.maxExposureUsd,
    maxDailyLossUsd: file.maxDailyLossUsd ?? DEFAULTS.maxDailyLossUsd,
  };

  return cached;
}

export function clearPaperBudgetCache() {
  cached = null;
}

export const PAPER_BUDGET_DEFAULTS = DEFAULTS;
