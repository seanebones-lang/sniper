import { test, expect } from '@playwright/test';

test.describe('Backtest & Settings', () => {
  test('backtest page loads historical replay section', async ({ page }) => {
    await page.goto('/backtest');

    await expect(page.getByRole('heading', { name: /Research & Backtesting Lab/i })).toBeVisible();
    await expect(page.getByText('Historical Order Book Replay')).toBeVisible();
    await expect(page.getByRole('button', { name: /Run Historical Replay/i })).toBeVisible();
  });

  test('settings page shows Grok API key section', async ({ page }) => {
    await page.goto('/settings');

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.getByText('Grok API Key (xAI)')).toBeVisible();
    await expect(page.getByText('24/7 Research Agent')).toBeVisible();
  });

  test('health API returns valid JSON', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.ok()).toBeTruthy();

    const data = await res.json();
    expect(data).toHaveProperty('risk');
    expect(data.risk).toHaveProperty('mode');
    expect(data).toHaveProperty('timestamp');
  });

  test('synthetic backtest shows results', async ({ page }) => {
    await page.goto('/backtest');
    await page.getByRole('button', { name: 'Run Synthetic Backtest' }).click();
    await expect(page.getByText('Synthetic Result')).toBeVisible();
    await expect(page.getByText('Total PnL')).toBeVisible();
  });

  test('historical replay shows UI results not raw JSON', async ({ page }) => {
    await page.goto('/backtest');
    await page.getByRole('button', { name: /Run Historical Replay/i }).click();
    await expect(page.getByText('Historical Replay Result')).toBeVisible({ timeout: 15_000 });

    await expect(page.getByText('Trades', { exact: true })).toBeVisible();
    await expect(page.locator('pre').filter({ hasText: '"snapshotCount"' })).toHaveCount(0);
  });
});
