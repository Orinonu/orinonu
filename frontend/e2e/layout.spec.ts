import { test, expect, type Locator, type Page } from "@playwright/test";
import { setupApi, snapshotFixture, WORKSPACE } from "./fixtures";

const widths = [320, 360, 390, 768, 1280];
const viewport = (width: number) => ({ width, height: width === 1280 ? 720 : 829 });

async function expectNoPageOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.documentElement.clientWidth,
  }))).toEqual({ document: 0, body: 0 });
}

async function expectUncovered(control: Locator, minimumSize = 24) {
  await expect(control).toBeVisible();
  const geometry = await control.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const points = [0.15, 0.5, 0.85];
    return {
      width: bounds.width, height: bounds.height,
      inViewport: bounds.left >= 0 && bounds.right <= document.documentElement.clientWidth && bounds.top >= 0 && bounds.bottom <= window.innerHeight,
      hit: points.every(x => points.every(y => element.contains(document.elementFromPoint(bounds.left + bounds.width * x, bounds.top + bounds.height * y)))),
    };
  });
  expect(geometry.width).toBeGreaterThanOrEqual(minimumSize);
  expect(geometry.height).toBeGreaterThanOrEqual(minimumSize);
  expect(geometry.inViewport).toBe(true);
  expect(geometry.hit).toBe(true);
}

async function expectKeyboardFocus(control: Locator) {
  await control.focus();
  await expect(control).toBeFocused();
  expect(await control.evaluate(element => {
    const style = getComputedStyle(element);
    return element.matches(":focus-visible") && style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2;
  })).toBe(true);
}

for (const width of widths) {
  for (const paused of [false, true]) {
    test(`toolbar remains readable and independently operable at ${width}px${paused ? " with execution paused" : ""}`, async ({ page }) => {
      const api = await setupApi(page);
      if (paused) api.responses.set("/api/state", { body: { ...snapshotFixture(), executor_pause: { status: "paused", resume_at_ms: null } } });
      await page.setViewportSize(viewport(width));
      await page.goto("/#board");
      await expect(page.locator(".kanban-column")).toHaveCount(6);
      const picker = page.getByRole("button", { name: "Trocar projeto", exact: true });
      await expectUncovered(picker, 44);
      expect((await picker.boundingBox())!.width).toBeGreaterThanOrEqual(120);
      const identity = page.locator(".project-picker strong");
      await expect(identity).toHaveText("Orinonu-Auditoria");
      expect((await identity.boundingBox())!.width).toBeGreaterThanOrEqual(80);
      expect(await identity.evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(12);
      for (const label of ["Supervisionado", "Autônomo"]) {
        await expectUncovered(page.getByRole("radio", { name: label, exact: true }), width <= 900 ? 44 : 24);
      }
      if (width <= 900) await expectUncovered(page.getByRole("button", { name: "Abrir menu", exact: true }), 44);
      if (paused) await expectUncovered(page.getByRole("button", { name: "Ver aviso de execução pausada", exact: true }), 44);
      await expectNoPageOverflow(page);
      const mainTop = await page.locator("main").evaluate(element => element.getBoundingClientRect().top);
      const toolbarBottom = await page.locator(".topbar").evaluate(element => element.getBoundingClientRect().bottom);
      expect(mainTop).toBeGreaterThanOrEqual(toolbarBottom);
      await page.keyboard.press("Tab");
      await expectKeyboardFocus(picker);
      await picker.press("Enter");
      await expect(page.locator(".project-dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(picker).toBeFocused();
      await expect(page.locator(".board-toolbar, .board-summary, .kanban-chips, .filter-result, .list-mode")).toHaveCount(0);
      expect(api.mutations).toEqual([]);
      expect(api.unexpected).toEqual([]);
    });
  }

  test(`sidebar owns reduced-height scrolling and keeps About reachable at ${width}px`, async ({ page }) => {
    const api = await setupApi(page);
    await page.setViewportSize({ width, height: 480 });
    await page.goto("/#board");
    await expect(page.locator(".kanban-column")).toHaveCount(6);
    const sidebar = page.locator(".sidebar");
    const menu = page.getByRole("button", { name: "Abrir menu", exact: true });
    if (width <= 900) {
      await menu.click();
      await expect(sidebar).toHaveAttribute("aria-modal", "true");
      await expect(page.locator(".main-shell")).toHaveAttribute("inert", "");
      await expect(sidebar.getByRole("button", { name: "Orinonu · visão geral", exact: true })).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(sidebar.locator(".brand-community")).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(sidebar.getByRole("button", { name: "Orinonu · visão geral", exact: true })).toBeFocused();
    }
    const about = sidebar.locator(".brand-community");
    await about.scrollIntoViewIfNeeded();
    await expectUncovered(about, 44);
    const scroll = await sidebar.evaluate(element => ({ top: element.scrollTop, overflow: getComputedStyle(element).overflowY, height: element.clientHeight, content: element.scrollHeight }));
    expect(["auto", "scroll"]).toContain(scroll.overflow);
    expect(scroll.top).toBeGreaterThan(0);
    expect(scroll.content).toBeGreaterThan(scroll.height);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    if (width <= 900) {
      await page.keyboard.press("Escape");
      await expect(menu).toBeFocused();
      await expect(page.locator(".main-shell")).not.toHaveAttribute("inert", "");
      await menu.click();
      await about.scrollIntoViewIfNeeded();
    }
    await about.click();
    await expect(page.locator(".brand-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    expect(api.mutations).toEqual([]);
    expect(api.unexpected).toEqual([]);
  });

  test(`direction drafts, textarea hit targets and save access survive scrolling at ${width}px`, async ({ page }) => {
    const api = await setupApi(page);
    await page.setViewportSize(viewport(width));
    const missionText = "Rascunho de missão sintética preservado durante consultas.";
    const visionText = "Rascunho de visão sintética preservado durante consultas.";
    const saved = { ...snapshotFixture().project_directions![0], workspace: WORKSPACE, mission: missionText, vision: visionText };
    api.allow("PATCH", "/api/project-direction", { body: saved });
    await page.goto("/#direction");
    const mission = page.locator("#mission");
    const vision = page.locator("#vision");
    const bar = page.locator(".save-bar");
    const fields = page.locator(".direction-page textarea");
    await expect(fields).toHaveCount(6);
    for (const field of await fields.all()) {
      await field.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        window.scrollBy(0, bounds.top - Math.max(12, (window.innerHeight - bounds.height) / 2));
      });
      await expectUncovered(field);
      expect(await field.evaluate(element => {
        const a = element.getBoundingClientRect(), b = document.querySelector(".save-bar")!.getBoundingClientRect();
        return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
      })).toBe(false);
    }
    await mission.fill(missionText);
    await vision.fill(visionText);
    const direction = { ...snapshotFixture(), project_directions: [{ ...snapshotFixture().project_directions![0], objective: "Objetivo atualizado pela consulta sintética." }, snapshotFixture().project_directions![1]] };
    api.responses.set("/api/state", { body: direction });
    await expect.poll(() => page.locator(".direction-page .section-note").textContent(), { timeout: 12000 }).toContain("Rascunho local");
    await page.waitForResponse(response => new URL(response.url()).pathname === "/api/state");
    await expect(mission).toHaveValue(missionText);
    await expect(vision).toHaveValue(visionText);
    await expectNoPageOverflow(page);
    const save = page.getByRole("button", { name: "Salvar direção", exact: true });
    await bar.scrollIntoViewIfNeeded();
    await expectUncovered(save, 44);
    expect(await bar.evaluate(element => {
      const bar = element.getBoundingClientRect();
      return [...document.querySelectorAll(".direction-page textarea")].every(field => field.getBoundingClientRect().bottom <= bar.top);
    })).toBe(true);
    await page.keyboard.press("Tab");
    await expectKeyboardFocus(save);
    await save.press("Enter");
    await expect.poll(() => api.mutations.length).toBe(1);
    expect(api.mutations[0]).toMatchObject({ method: "PATCH", path: "/api/project-direction", body: { workspace: WORKSPACE, mission: missionText, vision: visionText } });
    expect(api.unexpected).toEqual([]);
  });
}

for (const size of [{ width: 390, height: 829 }, { width: 1050, height: 900 }]) {
  test(`pause polling remeasures the taller toolbar at ${size.width}px without resetting board scroll or focus`, async ({ page }) => {
    const api = await setupApi(page);
    await page.setViewportSize(size);
    await page.goto("/#board");
    const board = page.getByRole("region", { name: "Quadro de missões", exact: true });
    const toolbar = page.locator(".topbar");
    const lane = page.locator(".lane-backlog > div").first();
    const pause = page.getByRole("button", { name: "Ver aviso de execução pausada", exact: true });
    await expect(board).toBeVisible();
    await expect.poll(() => board.evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(size.height);
    await board.focus();
    await board.press("End");
    await expect.poll(() => board.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    await lane.evaluate(element => { element.scrollTop = 80; });
    const initial = {
      toolbarHeight: await toolbar.evaluate(element => element.getBoundingClientRect().height),
      boardHeight: await board.evaluate(element => element.getBoundingClientRect().height),
      horizontal: await board.evaluate(element => element.scrollLeft),
      vertical: await lane.evaluate(element => element.scrollTop),
    };
    expect(initial.vertical).toBe(80);
    const response = page.waitForResponse(response => new URL(response.url()).pathname === "/api/state");
    api.responses.set("/api/state", { body: { ...snapshotFixture(), executor_pause: { status: "paused", resume_at_ms: null } } });
    await response;
    await expectUncovered(pause, 44);
    expect(await toolbar.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(initial.toolbarHeight);
    await expect.poll(() => board.evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(size.height);
    await expect.poll(() => board.evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(initial.boardHeight);
    await expect(board).toBeFocused();
    expect(await board.evaluate(element => element.scrollLeft)).toBeCloseTo(initial.horizontal, 0);
    expect(await lane.evaluate(element => element.scrollTop)).toBe(initial.vertical);
    const resumed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/state");
    api.responses.set("/api/state", { body: snapshotFixture() });
    await resumed;
    await expect(pause).toHaveCount(0);
    await expect.poll(() => toolbar.evaluate(element => element.getBoundingClientRect().height)).toBe(initial.toolbarHeight);
    await expect.poll(() => board.evaluate(element => element.getBoundingClientRect().height)).toBe(initial.boardHeight);
    await expect(board).toBeFocused();
    expect(await board.evaluate(element => element.scrollLeft)).toBeCloseTo(initial.horizontal, 0);
    expect(await lane.evaluate(element => element.scrollTop)).toBe(initial.vertical);
    await expectNoPageOverflow(page);
    expect(api.mutations).toEqual([]);
    expect(api.unexpected).toEqual([]);
  });
}

test("1280×720 shows three complete cards, contains board scrolling and keeps keyboard navigation", async ({ page }) => {
  const api = await setupApi(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/#board");
  await expect(page.locator(".kanban-column")).toHaveCount(6);
  await expect.poll(() => page.locator(".kanban-column").evaluateAll(columns => columns.map(column => {
    const region = column.querySelector(":scope > div")!, bounds = region.getBoundingClientRect();
    return [...region.querySelectorAll(":scope > .mission-card")].filter(card => {
      const rect = card.getBoundingClientRect();
      return rect.top >= bounds.top && rect.bottom <= bounds.bottom;
    }).length;
  }))).toEqual([3, 3, 3, 3, 3, 3]);
  const board = page.getByRole("region", { name: "Quadro de missões", exact: true });
  expect(await board.evaluate(element => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(720);
  const lane = page.getByRole("region", { name: "Fila · missões", exact: true });
  await lane.evaluate(element => { element.scrollTop = element.scrollHeight; });
  expect(await lane.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.locator(".kanban-column > div").nth(1).evaluate(element => element.scrollTop)).toBe(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.keyboard.press("Tab");
  await expectKeyboardFocus(board);
  await page.keyboard.press("End");
  await expect.poll(() => board.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  expect(await board.evaluate(element => getComputedStyle(element).scrollBehavior)).not.toBe("smooth");
  await expectNoPageOverflow(page);
  expect(api.mutations).toEqual([]);
  expect(api.unexpected).toEqual([]);
});
