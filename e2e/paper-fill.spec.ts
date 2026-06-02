import { test, expect } from '@playwright/test';

test.describe('Paper fill flow', () => {
  test('manual paper fill via API and market page UI', async ({ page, request }) => {
    // Get a real market token from API
    const marketsRes = await request.get('/api/markets');
    expect(marketsRes.ok()).toBeTruthy();
    const { markets } = await marketsRes.json();
    expect(markets.length).toBeGreaterThan(0);

    const market = markets[0];
    const fillRes = await request.post('/api/paper/fill', {
      data: {
        platform: market.platform,
        marketExternalId: market.externalId,
        side: 'BUY',
        price: 0.12,
        size: 10,
        reason: 'E2E test fill',
      },
    });
    expect(fillRes.ok()).toBeTruthy();
    const fillData = await fillRes.json();
    expect(fillData.fill).toBeDefined();
    expect(fillData.fill.side).toBe('BUY');
    expect(fillData.persistedId).toBeDefined();

    // Open market page and verify order book section renders
    await page.goto(`/markets/${market.platform}/${encodeURIComponent(market.externalId)}`);
    await expect(page.getByRole('button', { name: 'Execute Paper Fill' })).toBeVisible({ timeout: 15_000 });

    // Market question should load (not raw token ID as title)
    await expect(page.locator('h1')).not.toHaveText(market.externalId, { timeout: 15_000 });
  });
});
