import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';

const SETTINGS_PATH = path.join(process.cwd(), 'data', 'user-settings.json');

interface UserSettingsFile {
  paperRunStartedAt?: string;
  [key: string]: unknown;
}

async function readSettingsFile(): Promise<UserSettingsFile> {
  try {
    const raw = await readFile(SETTINGS_PATH, 'utf-8');
    return JSON.parse(raw) as UserSettingsFile;
  } catch {
    return {};
  }
}

async function writeSettingsFile(file: UserSettingsFile): Promise<void> {
  await mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
  await writeFile(SETTINGS_PATH, JSON.stringify(file, null, 2), 'utf-8');
}

export interface PaperRunSession {
  startedAt: string;
}

/**
 * When set, portfolio UI and runner position logic only consider activity after this time.
 * Database rows are kept — this is a display / session boundary, not a delete.
 */
export async function getPaperRunStartedAt(): Promise<Date | null> {
  const file = await readSettingsFile();
  if (!file.paperRunStartedAt) return null;
  const d = new Date(file.paperRunStartedAt);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function startNewPaperRun(): Promise<PaperRunSession> {
  const startedAt = new Date().toISOString();
  const file = await readSettingsFile();
  file.paperRunStartedAt = startedAt;
  await writeSettingsFile(file);

  const { paperSimulator } = await import('@/lib/execution/paper-simulator');
  paperSimulator.reset();

  const { resetRunnerSessionCounters } = await import('@/lib/runner/engine');
  resetRunnerSessionCounters();

  return { startedAt };
}

/** Effective filter start: current run session, or rolling period window. */
export async function getPaperPortfolioSince(periodDays: number): Promise<Date> {
  const runStart = await getPaperRunStartedAt();
  const periodSince = new Date(Date.now() - periodDays * 24 * 3600 * 1000);
  if (runStart && runStart > periodSince) return runStart;
  return periodSince;
}
