import { test, expect } from "@playwright/test";

const BASE_URL = process.env.UI_BASE_URL || "https://sinkai.tokyo";

async function dismissCookieOrOverlay(page: any) {
  const candidates = [
    page.getByRole("button", { name: /accept|agree|同意|OK/i }),
    page.getByRole("button", { name: /close|閉じる/i })
  ];
  for (const c of candidates) {
    if (await c.first().isVisible().catch(() => false)) {
      await c.first().click({ timeout: 1000 }).catch(() => {});
    }
  }
}

test.describe("sinkai.tokyo UI smoke", () => {
  test("login transition keeps next param", async ({ page }) => {
    await page.goto(`${BASE_URL}/tasks?lang=ja`, { waitUntil: "domcontentloaded" });
    await dismissCookieOrOverlay(page);

    const accountLink = page.locator('a[href^="/auth?"][href*="next="]').first();
    await expect(accountLink).toBeVisible();

    const href = await accountLink.getAttribute("href");
    expect(href).toBeTruthy();

    const authUrl = new URL(href!, BASE_URL);
    expect(authUrl.pathname).toBe("/auth");
    const next = authUrl.searchParams.get("next") || "";
    expect(next).toContain("/tasks");
    expect(next).toContain("lang=ja");

    await page.screenshot({
      path: "output/playwright/login-next-param.png",
      fullPage: true
    });
  });

  test.describe("mobile filters", () => {
    test("advanced filters collapse and open by toggle", async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${BASE_URL}/tasks?lang=ja`, { waitUntil: "domcontentloaded" });
      await dismissCookieOrOverlay(page);

      await expect(page.getByText(/キーワード検索|Search keyword/i)).toBeVisible();
      const advancedField = page.getByText(/タスクラベル|Task label/i).first();
      await expect(advancedField).toBeHidden();

      const toggle = page.getByRole("button", { name: /絞り込みを表示|Show filters/i }).first();
      await expect(toggle).toBeVisible();
      await toggle.click();

      await expect(page.getByText(/タスクラベル|Task label/i).first()).toBeVisible();
      await page.screenshot({
        path: "output/playwright/mobile-filters-open.png",
        fullPage: true
      });
    });
  });

  test("task detail CTA is large enough and navigates", async ({ page }) => {
    await page.goto(`${BASE_URL}/tasks?lang=ja`, { waitUntil: "domcontentloaded" });
    await dismissCookieOrOverlay(page);

    const cta = page.locator(".task-detail-cta").first();
    await expect(cta).toBeVisible();

    const box = await cta.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.height || 0) >= 40).toBeTruthy();

    const href = (await cta.getAttribute("href")) || "";
    expect(href).toContain("/tasks/");

    await Promise.all([
      page.waitForURL(/\/tasks\/[0-9a-f-]+\?lang=/i, { timeout: 15000 }),
      cta.click()
    ]);

    await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]+\?lang=/i);
    await page.screenshot({
      path: "output/playwright/task-detail-opened.png",
      fullPage: true
    });
  });
});
