import { test, expect } from '@playwright/test';

test.describe('Markets', () => {
  test('markets page loads and fetches market data', async ({ page }) => {
    await page.goto('/markets');

    await expect(page.getByRole('heading', { name: 'Markets' })).toBeVisible();

    // Table populated with market rows
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Loading markets…')).not.toBeVisible({ timeout: 30_000 });
    await expect(page.locator('tbody tr')).not.toHaveCount(0);
  });

  test('markets list shows last prices', async ({ page }) => {
    await page.goto('/markets');
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 30_000 });

    // Last price column should show cents, not em-dash
    const firstPriceCell = page.locator('tbody tr').first().locator('td').nth(2);
    await expect(firstPriceCell).not.toHaveText('—');
    await expect(firstPriceCell).toContainText('¢');
  });
  test('can open a market detail page with order book', async ({ page }) => {
    await page.goto('/markets');

    // Wait for first market row link
    const marketLink = page.locator('tbody tr a').first();
    await expect(marketLink).toBeVisible({ timeout: 30_000 });
    await marketLink.click();

    await expect(page).toHaveURL(/\/markets\/(polymarket|kalshi)\//);
    await expect(page.getByText('Bids', { exact: true })).toBeVisible();
    await expect(page.getByText('Asks', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Execute Paper Fill' })).toBeVisible();
  });
});
