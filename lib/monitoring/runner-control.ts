/**
 * Durable runner intent — survives deploys so live mode can auto-restart
 * unless the operator explicitly stopped the runner from the UI.
 */
import { loadSystemState, persistSystemState } from '@/lib/monitoring/system-state';

export type RunnerDesiredState = 'running' | 'stopped';

export interface RunnerControlState {
  desired: RunnerDesiredState;
  updatedAt: string;
  updatedBy: 'user' | 'system';
}

const KEY = 'runner_control' satisfies import('@/lib/monitoring/system-state').SystemStateKey;

export async function loadRunnerControlState(): Promise<RunnerControlState> {
  const row = await loadSystemState<RunnerControlState>(KEY);
  if (row?.desired === 'running' || row?.desired === 'stopped') return row;
  return {
    desired: 'running',
    updatedAt: new Date(0).toISOString(),
    updatedBy: 'system',
  };
}

export async function persistRunnerDesiredState(
  desired: RunnerDesiredState,
  updatedBy: RunnerControlState['updatedBy'],
  reason?: string,
): Promise<void> {
  await persistSystemState(
    KEY,
    {
      desired,
      updatedAt: new Date().toISOString(),
      updatedBy,
    } satisfies RunnerControlState,
    reason ?? `runner desired ${desired}`,
  );
}

/** Live mode keeps the runner up unless the operator stopped it (runner_control). Paper uses SNIPER_AUTO_START_RUNNER. */
export async function shouldAutoStartRunner(): Promise<boolean> {
  if (process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true') {
    const control = await loadRunnerControlState();
    return control.desired === 'running';
  }
  return process.env.SNIPER_AUTO_START_RUNNER === 'true';
}
