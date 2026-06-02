import { test, expect } from '@playwright/test';

test.describe('Landing & navigation', () => {
  test('homepage loads and links to dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'SNIPER' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open Dashboard' })).toBeVisible();

    await page.getByRole('link', { name: 'Open Dashboard' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('dashboard has links to main sections', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('link', { name: /Markets/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Strategies & Runner/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Settings/i }).first()).toBeVisible();
  });
});
