/**
 * Production: auto-start the trading runner when configured.
 * Live mode: auto-starts on deploy and runs a watchdog to restart if the loop
 * stops unexpectedly (unless the operator stopped it from the UI).
 * Only runs in the Node.js server runtime (not edge).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') return;

  const live = process.env.SNIPER_ENABLE_REAL_EXECUTION === 'true';
  const paperAutoStart = process.env.SNIPER_AUTO_START_RUNNER === 'true';

  if (live && !process.env.SNIPER_API_SECRET?.trim()) {
    console.warn(
      '[instrumentation] ⚠️ SNIPER_ENABLE_REAL_EXECUTION=true but SNIPER_API_SECRET is unset — ' +
        'all mutating API routes (runner control, strategy edits, live filters) are UNAUTHENTICATED. ' +
        'Set SNIPER_API_SECRET before exposing this deployment publicly.',
    );
  }

  if (!live && !paperAutoStart) return;

  const { shouldAutoStartRunner } = await import('@/lib/monitoring/runner-control');
  if (!(await shouldAutoStartRunner())) {
    console.log('[instrumentation] Runner auto-start skipped — operator stopped the runner.');
    if (live) {
      const { startLiveRunnerWatchdog } = await import('@/lib/runner/engine');
      startLiveRunnerWatchdog();
    }
    return;
  }

  const { bootstrapPolymarketHttpFromEnv, bootstrapPolymarketHttp } = await import(
    '@/lib/clients/polymarket-http-proxy'
  );
  bootstrapPolymarketHttpFromEnv();
  await bootstrapPolymarketHttp();

  const { startRunner, getRunnerIntervalMs, startLiveRunnerWatchdog } = await import(
    '@/lib/runner/engine'
  );

  if (live) {
    startLiveRunnerWatchdog();
  }

  const delayMs = parseInt(process.env.SNIPER_RUNNER_START_DELAY_MS ?? '20000', 10);
  setTimeout(() => {
    void (async () => {
      const intervalMs = await getRunnerIntervalMs();
      await startRunner(intervalMs);
    })().catch((err) => {
      console.error('[instrumentation] Failed to auto-start runner:', err);
    });
  }, Number.isFinite(delayMs) ? delayMs : 20000);

  if (live) {
    console.log(
      '[instrumentation] Live execution enabled — runner will auto-start and self-restart if it stops.',
    );
  }
}
