/**
 * Production: auto-start the trading runner when SNIPER_AUTO_START_RUNNER=true.
 * Only runs in the Node.js server runtime (not edge).
 */
export async function register() {
  if (process.env.SNIPER_AUTO_START_RUNNER !== 'true') return;
  if (process.env.NEXT_RUNTIME === 'edge') return;

  const { bootstrapPolymarketHttpFromEnv, bootstrapPolymarketHttp } = await import(
    '@/lib/clients/polymarket-http-proxy'
  );
  bootstrapPolymarketHttpFromEnv();
  await bootstrapPolymarketHttp();

  const { startRunner, getRunnerIntervalMs } = await import('@/lib/runner/engine');
  const delayMs = parseInt(process.env.SNIPER_RUNNER_START_DELAY_MS ?? '20000', 10);
  setTimeout(() => {
    void (async () => {
      const intervalMs = await getRunnerIntervalMs();
      await startRunner(intervalMs);
    })().catch((err) => {
      console.error('[instrumentation] Failed to auto-start runner:', err);
    });
  }, Number.isFinite(delayMs) ? delayMs : 20000);
}
