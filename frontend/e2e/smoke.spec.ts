import { test, expect } from "@playwright/test";
import { setupApi } from "./fixtures";

const views = { overview: "Visão geral", direction: "Direção do projeto", board: "Missões", research: "Pesquisa e referências", decisions: "Decisões JEV", evaluations: "Avaliações e evidências", agents: "Agentes e etapas", curation: "Harness e curadoria", updates: "Atualizações", settings: "Configurações" };

test("all views load without contacting a real API or starting work", async ({ page }) => {
  const api = await setupApi(page);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/#overview");
  await expect(page.locator(".overview")).toBeVisible();
  for (const [view, heading] of Object.entries(views)) {
    await page.evaluate(value => { location.hash = value; }, view);
    await expect(page.locator("main h1")).toHaveText(heading);
  }
  expect(errors).toEqual([]);
  expect(api.unexpected).toEqual([]);
  expect(api.mutations).toEqual([]);
});

test("the documented desktop baseline keeps three complete cards and all six lanes", async ({ page }) => {
  const api = await setupApi(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/#board");
  await expect(page.locator(".kanban-column")).toHaveCount(6);
  await expect.poll(async () => page.locator(".kanban-column").evaluateAll(columns => columns.slice(0, 4).map(column => {
    const region = column.querySelector(":scope > div")!, bounds = region.getBoundingClientRect();
    return [...region.querySelectorAll(":scope > .mission-card")].filter(card => {
      const rect = card.getBoundingClientRect(); return rect.top >= bounds.top && rect.bottom <= bounds.bottom;
    }).length;
  }))).toEqual([3, 3, 3, 3]);
  await expect(page.getByRole("textbox", { name: "Buscar missões" })).toHaveCount(0);
  expect(api.unexpected).toEqual([]);
});
