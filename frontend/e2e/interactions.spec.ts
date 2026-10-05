import { test, expect } from "@playwright/test";
import { setupApi, snapshotFixture, WORKSPACE } from "./fixtures";

for (const launcherName of ["Trocar projeto", "Nova missão"]) {
  test(`controlled dialog restores ${launcherName} focus and keeps keyboard focus inside`, async ({ page }) => {
    const api = await setupApi(page);
    await page.goto("/#board");
    const launcher = page.getByRole("button", { name: launcherName, exact: true });
    await expect(launcher).toBeEnabled();
    await launcher.focus();
    await launcher.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleName(launcherName === "Trocar projeto" ? "Escolher projeto" : "Nova missão");
    await expect(dialog).toHaveAccessibleDescription(/Missões, direção|Defina um resultado/);
    for (const key of ["Tab", "Shift+Tab"]) {
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press(key);
        expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
      }
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(launcher).toBeFocused();
    await launcher.press("Enter");
    await dialog.getByRole("button", { name: "Fechar", exact: true }).click();
    await expect(launcher).toBeFocused();
    expect(api.mutations).toEqual([]);
    expect(api.unexpected).toEqual([]);
  });
}

test("mission details and the specialist DialogTrigger both return to their launchers", async ({ page }) => {
  const api = await setupApi(page);
  await page.goto("/#board");
  const mission = page.locator(".mission-card").first().getByRole("button").first();
  await mission.focus();
  await mission.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(mission).toBeFocused();
  await page.evaluate(() => { location.hash = "agents"; });
  const profile = page.getByRole("button", { name: "Ver perfil de Engenharia geral", exact: true });
  await profile.focus();
  await profile.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(profile).toBeFocused();
  expect(api.mutations).toEqual([]);
  expect(api.unexpected).toEqual([]);
});

for (const unavailable of ["removed", "disabled"]) {
  test(`dialog returns to an available control when its launcher is ${unavailable}`, async ({ page }) => {
    const api = await setupApi(page);
    await page.goto("/#board");
    const launcher = page.getByRole("button", { name: "Nova missão", exact: true });
    await expect(launcher).toBeEnabled();
    const launcherHandle = await launcher.elementHandle();
    await launcher.focus();
    await launcher.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    // Once the dialog opens, Radix hides the launcher tree from the accessibility tree; keep a
    // direct element handle so the state change can still be applied while the dialog is open.
    await launcherHandle!.evaluate((element, state) => {
      if (state === "removed") element.remove();
      else (element as HTMLButtonElement).disabled = true;
    }, unavailable);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => {
      const active = document.activeElement;
      return active instanceof HTMLElement && active !== document.body && active.isConnected &&
        !active.matches(":disabled") && !active.closest('[role="dialog"]');
    })).toBe(true);
    expect(api.mutations).toEqual([]);
    expect(api.unexpected).toEqual([]);
  });
}

test("autonomy arrow navigation roves focus without a request; Space explicitly selects once", async ({ page }) => {
  const api = await setupApi(page);
  api.allow("POST", "/api/autonomy", { body: { mode: "autonomous" } });
  await page.goto("/#board");
  const group = page.getByRole("radiogroup", { name: "Modo do projeto" });
  const supervised = group.getByRole("radio", { name: "Supervisionado", exact: true });
  const autonomous = group.getByRole("radio", { name: "Autônomo", exact: true });
  await expect(supervised).toBeEnabled();
  await supervised.focus();
  await supervised.press("ArrowRight");
  await expect(autonomous).toBeFocused();
  await expect(autonomous).toHaveAttribute("tabindex", "0");
  await expect(supervised).toHaveAttribute("tabindex", "-1");
  await expect(supervised).toHaveAttribute("aria-checked", "true");
  await expect(autonomous).toHaveAttribute("aria-checked", "false");
  await autonomous.press("ArrowRight");
  await expect(supervised).toBeFocused();
  await supervised.press("End");
  await expect(autonomous).toBeFocused();
  await autonomous.press("Home");
  await expect(supervised).toBeFocused();
  await supervised.press("ArrowLeft");
  await expect(autonomous).toBeFocused();
  expect(api.mutations).toEqual([]);
  const next = snapshotFixture();
  next.autonomy_policies = [{ workspace: WORKSPACE, mode: "autonomous" }];
  api.responses.set("/api/state", { body: next });
  await autonomous.press("Space");
  await expect(autonomous).toHaveAttribute("aria-checked", "true");
  expect(api.mutations).toEqual([{ method: "POST", path: "/api/autonomy", body: { workspace: WORKSPACE, mode: "autonomous" } }]);
  await autonomous.press("Enter");
  expect(api.mutations).toHaveLength(1);
  expect(api.unexpected).toEqual([]);
});

test("info notices stay accessible in a modal and pause their remaining six seconds on hover or focus", async ({ page }) => {
  const api = await setupApi(page);
  api.allow("POST", "/api/autonomy", { body: { mode: "autonomous" } });
  await page.clock.install({ time: new Date("2026-10-05T12:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-05T12:00:01Z"));
  await page.goto("/#board");
  await page.getByRole("radio", { name: "Autônomo", exact: true }).click();
  const notice = page.getByRole("status").filter({ hasText: "Modo autônomo ativado:" });
  await expect(notice).toBeVisible();
  await page.mouse.move(0, 0);
  await page.clock.runFor(2000);
  await page.getByRole("button", { name: "Nova missão", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nova missão", exact: true });
  await expect(dialog.getByRole("status").filter({ hasText: "Modo autônomo ativado:" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Notificações" })).toHaveCount(1);
  expect(await notice.evaluate(element => !!element.closest('[aria-hidden="true"]'))).toBe(false);
  expect(await dialog.evaluate(element => element.contains(document.activeElement) && !document.activeElement?.closest(".notification-center"))).toBe(true);
  await notice.hover();
  await page.clock.runFor(8000);
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: "Fechar Atualização" }).focus();
  await page.mouse.move(0, 0);
  await page.clock.runFor(8000);
  await expect(notice).toBeVisible();
  await dialog.getByLabel("Título da missão").focus();
  await page.clock.runFor(3999);
  await expect(notice).toBeVisible();
  await page.clock.runFor(1);
  await expect(notice).toHaveCount(0);
  expect(api.unexpected).toEqual([]);
  expect(api.mutations).toHaveLength(1);
});

test("modal errors remain announced and dismissible across dialog close/reopen without stealing focus", async ({ page }) => {
  const api = await setupApi(page);
  api.allow("POST", "/api/tasks", { status: 503, body: { error: "Falha sintética ao salvar." } });
  await page.clock.install({ time: new Date("2026-10-05T12:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-05T12:00:01Z"));
  await page.goto("/#board");
  const launcher = page.getByRole("button", { name: "Nova missão", exact: true });
  await launcher.click();
  const dialog = page.getByRole("dialog", { name: "Nova missão", exact: true });
  await dialog.getByLabel("Título da missão").fill("Teste sem execução");
  await dialog.getByLabel("Objetivo", { exact: true }).fill("Objetivo sintético.");
  await dialog.getByLabel("Critérios de sucesso").fill("Somente API simulada.");
  const submit = dialog.getByRole("button", { name: "Criar missão e consultar plano" });
  await submit.click();
  const notice = page.getByRole("alert").filter({ hasText: "Falha sintética ao salvar." });
  await expect(notice).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(1);
  expect(await notice.evaluate(element => !!element.closest('[aria-hidden="true"]'))).toBe(false);
  expect(await dialog.evaluate(element => element.contains(document.activeElement) && !document.activeElement?.closest(".notification-center"))).toBe(true);
  await page.clock.runFor(20000);
  await expect(notice).toBeVisible();
  await page.keyboard.press("Escape");
  await page.clock.runFor(1);
  await expect(launcher).toBeFocused();
  await expect(notice).toBeVisible();
  await launcher.press("Enter");
  await expect(dialog.getByRole("alert")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Fechar Operação não concluída" }).click();
  await expect(notice).toHaveCount(0);
  expect(api.mutations).toHaveLength(1);
  expect(api.unexpected).toEqual([]);
});

test("report links retain safe destinations without fetching media and the raw original remains intact", async ({ page }) => {
  const api = await setupApi(page);
  const snapshot = snapshotFixture();
  const url = "https://example.org/" + "evidence".repeat(80);
  const original = `# Plano\n\n## Etapas\n\n### Evidência\n\n[Fonte](${url})\n\n[Inseguro](javascript:alert%281%29)\n\n![Diagrama](https://example.org/image.png)\n\n<script>window.UNSAFE = true</script>\n\n\`\`\`ts\nconst safe = "<text>";\n\`\`\``;
  snapshot.tasks![0].plan_report = original;
  api.responses.set("/api/state", { body: snapshot });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#board");
  await page.locator(".mission-card").first().getByRole("button").first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: /Relatórios/ }).click();
  const report = dialog.locator(".mission-report").first();
  const reference = report.getByRole("link", { name: /Fonte/ });
  await expect(reference).toHaveAttribute("href", url);
  await expect(reference).toHaveAttribute("target", "_blank");
  await expect(reference).toHaveAttribute("rel", "noopener noreferrer nofollow");
  await expect(reference).toContainText(url);
  await expect(report.locator("img, iframe, script")).toHaveCount(0);
  await expect(report.getByText(/não navegável/)).toContainText("javascript:alert%281%29");
  await expect(report.getByText(/Imagem citada:/)).toContainText("https://example.org/image.png");
  await expect(report.getByRole("heading", { level: 4 })).toHaveText("Plano");
  await expect(report.getByRole("heading", { level: 5 })).toHaveText("Etapas");
  await expect(report.getByRole("heading", { level: 6 })).toHaveText("Evidência");
  await report.getByText("Ver texto original", { exact: true }).click();
  expect(await report.locator(".technical-note pre").textContent()).toBe(original);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(api.mutations).toEqual([]);
  expect(api.unexpected).toEqual([]);
});
