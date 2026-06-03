import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { loadSystemState, persistSystemState } from '@/lib/monitoring/system-state';

export interface PaperBudgetSettings {
  paperBudgetUsd: number;
  maxExposureUsd: number;
  maxDailyLossUsd: number;
}

type StoredPaperSettings = Partial<PaperBudgetSettings> & {
  paperRunStartedAt?: string;
};

const DEFAULTS: PaperBudgetSettings = {
  paperBudgetUsd: 10_000,
  maxExposureUsd: 2_000,
  maxDailyLossUsd: 150,
};

const SETTINGS_PATH = path.join(process.cwd(), 'data', 'user-settings.json');

let cached: PaperBudgetSettings | null = null;

async function readFileSettings(): Promise<StoredPaperSettings> {
  try {
    const raw = await readFile(SETTINGS_PATH, 'utf-8');
    return JSON.parse(raw) as StoredPaperSettings;
  } catch {
    return {};
  }
}

async function writeFileSettings(file: StoredPaperSettings): Promise<void> {
  try {
    await mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
    await writeFile(SETTINGS_PATH, JSON.stringify(file, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[paper-budget] Could not write local file (ok on Railway):', err);
  }
}

async function loadStored(): Promise<StoredPaperSettings> {
  const fromDb = await loadSystemState<StoredPaperSettings>('paper_budget_settings');
  if (fromDb?.paperBudgetUsd != null) {
    return fromDb;
  }
  return readFileSettings();
}

async function saveStored(file: StoredPaperSettings): Promise<void> {
  await persistSystemState('paper_budget_settings', file, 'paper budget updated');
  await writeFileSettings(file);
}

export async function getPaperBudgetSettings(): Promise<PaperBudgetSettings> {
  if (cached) return cached;

  const stored = await loadStored();

  cached = {
    paperBudgetUsd: stored.paperBudgetUsd ?? DEFAULTS.paperBudgetUsd,
    maxExposureUsd: stored.maxExposureUsd ?? DEFAULTS.maxExposureUsd,
    maxDailyLossUsd: stored.maxDailyLossUsd ?? DEFAULTS.maxDailyLossUsd,
  };

  return cached;
}

export async function getPaperRunStartedAtFromSettings(): Promise<Date | null> {
  const stored = await loadStored();
  if (!stored.paperRunStartedAt) return null;
  const d = new Date(stored.paperRunStartedAt);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function setPaperBudgetSettings(
  partial: Partial<PaperBudgetSettings>,
): Promise<PaperBudgetSettings> {
  const file = await loadStored();
  const budgetChanged =
    partial.paperBudgetUsd != null && partial.paperBudgetUsd !== file.paperBudgetUsd;

  if (partial.paperBudgetUsd != null) file.paperBudgetUsd = partial.paperBudgetUsd;
  if (partial.maxExposureUsd != null) file.maxExposureUsd = partial.maxExposureUsd;
  if (partial.maxDailyLossUsd != null) file.maxDailyLossUsd = partial.maxDailyLossUsd;

  if (budgetChanged) {
    file.paperRunStartedAt = new Date().toISOString();
  }

  await saveStored(file);

  cached = {
    paperBudgetUsd: file.paperBudgetUsd ?? DEFAULTS.paperBudgetUsd,
    maxExposureUsd: file.maxExposureUsd ?? DEFAULTS.maxExposureUsd,
    maxDailyLossUsd: file.maxDailyLossUsd ?? DEFAULTS.maxDailyLossUsd,
  };

  if (budgetChanged) {
    const { invalidatePaperRiskCache } = await import('@/lib/paper/risk-state');
    invalidatePaperRiskCache();
    try {
      const { paperSimulator } = await import('@/lib/execution/paper-simulator');
      paperSimulator.reset();
      const { resetRunnerSessionCounters } = await import('@/lib/runner/engine');
      resetRunnerSessionCounters();
    } catch {
      // non-fatal on settings save
    }
  }

  return cached;
}

export async function setPaperRunStartedAt(iso: string): Promise<void> {
  const file = await loadStored();
  file.paperRunStartedAt = iso;
  await saveStored(file);
}

export function clearPaperBudgetCache() {
  cached = null;
}

export const PAPER_BUDGET_DEFAULTS = DEFAULTS;
