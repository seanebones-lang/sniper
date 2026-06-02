import { test, expect } from '@playwright/test';

test.describe('Strategies', () => {
  test('strategies page shows setup guide and form', async ({ page }) => {
    await page.goto('/strategies');

    await expect(page.getByRole('heading', { name: 'Strategies' })).toBeVisible();
    await expect(page.getByText('How strategies work')).toBeVisible();
    await expect(page.getByRole('button', { name: /New Strategy/i })).toBeVisible();
  });

  test('can open create strategy form with labeled fields', async ({ page }) => {
    await page.goto('/strategies');
    await page.getByRole('button', { name: /New Strategy/i }).click();

    await expect(page.getByText('Create New Strategy')).toBeVisible();
    await expect(page.getByText('Strategy name')).toBeVisible();
    await expect(page.getByText('Strategy type')).toBeVisible();
    await expect(page.getByText('Max size per trade (USD)')).toBeVisible();
    await expect(page.getByText('Target profit (%)')).toBeVisible();
    await expect(page.getByText('Cooldown between signals (seconds)')).toBeVisible();
    await expect(page.getByRole('button', { name: /Create & Save/i })).toBeVisible();
  });

  test('runner start/stop buttons are present', async ({ page }) => {
    await page.goto('/strategies');

    const startBtn = page.getByRole('button', { name: /Start 24\/7 Paper Runner/i });
    const stopBtn = page.getByRole('button', { name: /Stop 24\/7 Runner/i });

    await expect(startBtn.or(stopBtn)).toBeVisible();
  });
});
