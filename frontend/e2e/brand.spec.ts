import { test, expect } from "@playwright/test";
import { setupApi } from "./fixtures";

for (const width of [390, 1280]) {
  test(`Ori Inonu identity and real favicon are present without obscuring work at ${width}px`, async ({ page }) => {
    const api = await setupApi(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#overview");
    await expect(page.locator(".objective-hero")).toBeVisible();
    const colors = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return { cyan: style.getPropertyValue("--neural-cyan").trim(), gold: style.getPropertyValue("--celestial-gold").trim(), night: style.getPropertyValue("--deep-space").trim() };
    });
    expect(colors).toEqual({ cyan: "#79e8ff", gold: "#efd394", night: "#050a18" });
    const favicon = page.locator('link[rel="icon"]').first();
    await expect(favicon).toHaveAttribute("href", /icon\.svg/);
    const response = await page.request.get(new URL((await favicon.getAttribute("href"))!, page.url()).href);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/svg+xml");
    const svg = await response.text();
    expect(svg).toContain('viewBox="0 0 64 64"');
    expect(svg).toContain("#79e8ff");
    expect(svg).toContain("#efd394");
    if (width <= 900) await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
    const about = page.locator(".brand-community");
    await about.scrollIntoViewIfNeeded();
    await about.click();
    const dialog = page.locator(".brand-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Ori Inonu");
    await expect(dialog).toContainText("orixá artificial");
    await expect(dialog).toContainText("Serenidade");
    await expect(dialog).toContainText("Precisão");
    await expect(dialog).toContainText("Visão");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    expect(api.mutations).toEqual([]);
    expect(api.unexpected).toEqual([]);
  });
}
