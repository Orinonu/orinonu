import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EvolutionReportView } from "../src/components/evolution-view.tsx";
import { evolutionState, measuredCount, measuredPercent, type EvolutionData } from "../src/lib/evolution.ts";

const render = (data: EvolutionData | null, loading = false, error: string | null = null) => renderToStaticMarkup(createElement(EvolutionReportView, { report: { data, loading, error }, onRefresh: () => {}, onRunEpoch: () => {} }));

test("evolution distinguishes initial loading, failure, unknown and retained stale data", () => {
  assert.equal(evolutionState({ data: null, loading: true, error: null }), "loading");
  assert.equal(evolutionState({ data: null, loading: false, error: "offline" }), "error");
  assert.equal(evolutionState({ data: null, loading: false, error: null }), "unknown");
  assert.equal(evolutionState({ data: {}, loading: false, error: "offline" }), "stale");
  for (const out of [render(null, true), render(null, false, "offline"), render({})]) {
    assert.doesNotMatch(out, /0 de 0|0 executadas|0 registradas|Nenhuma época|Nenhuma campanha/);
    assert.match(out, /Não medido|Carregando|Indisponível/);
  }
  const stale = render({ metrics: { rework_count: 3 }, campaigns: [], epochs: [] }, false, "offline");
  assert.match(stale, /Dados anteriores|role="alert"/);
  assert.match(stale, /<strong>3<\/strong>/);
});

test("only finite nonnegative measurements render zero or percentages", () => {
  assert.equal(measuredCount(0), "0");
  for (const value of [undefined, null, NaN, Infinity, -1, 1.2, "0"]) assert.equal(measuredCount(value), "Não medido");
  assert.equal(measuredPercent(0), "0%");
  for (const value of [undefined, null, NaN, Infinity, -1, 101]) assert.equal(measuredPercent(value), "Não medido");
  assert.match(render({ metrics: { approved_reviews: 0, total_reviews: 0 }, campaigns: [], epochs: [] }), /0 de 0 revisões/);
});

test("manifest evidence and reported guards never certify immutable protection or invented defaults", () => {
  const out = render({ manifest_status: { valid: true, checked_files: [{ filename: "other.json", hash: "a".repeat(64) }] }, guards: { shadow_mode_default: false, min_paired_samples_for_promotion: 7, max_epoch_budget_usd: 0, immutable_boundaries: ["explicit_user_stop", "future_boundary"] }, epochs: [{ id: "epoch", simulated_result: { accuracy: 1 }, gate: { status: "promotable" }, applied: false }] });
  assert.match(out, /Escopo global|todos os projetos/);
  assert.match(out, /Hashes conferem|other.json|Não comprova proteção/);
  assert.match(out, /Guardas declaradas|7 amostras|future_boundary|Não aplicado|Resultado simulado/);
  assert.doesNotMatch(out, /Válido e imutável|Verificada: benchmark íntegro|≥ 10|Modo Padrão.*Modo Sombra/);
  assert.match(render({}), /Não informado/);
  const emptyManifest = render({ manifest_status: { valid: true, checked_files: [] } });
  assert.match(emptyManifest, /arquivos conferidos não informados/);
  assert.doesNotMatch(emptyManifest, /Hashes conferem/);
});
