import { test, expect } from "@playwright/test";

// @ts-nocheck - Playwright types can be finicky in some envs
test("homepage loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Sniper/i);
});

