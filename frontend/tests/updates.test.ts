import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describeUpdate, installedVersion, updateFreshness, UpdatesReport, type UpdateStatus } from "../src/components/updates-view.tsx";
import { brand } from "../src/lib/brand.ts";

test("approved version and commit distance are different facts", () => {
  assert.equal(brand.version, "0.0.5");
  assert.equal(describeUpdate({ status: "update_available", behind: 8, ahead: 0 }), "8 commits atrás de main");
  assert.equal(describeUpdate({ status: "up_to_date", behind: 0, ahead: 0 }), "Em dia com main");
});
test("unknown, offline, dirty and diverged provenance are never described as safely current", () => {
  assert.match(describeUpdate({ status: "untracked", behind: null }), /não identificado/);
  assert.match(describeUpdate({ status: "unavailable", behind: null }), /indisponível/);
  assert.match(describeUpdate({ status: "local_changes", behind: 8 }), /Alterações locais/);
  assert.match(describeUpdate({ status: "diverged", behind: 8, ahead: 2 }), /divergiu/);
});

test("missing installed metadata never falls back to the build brand version", () => {
  assert.equal(installedVersion(null), "Versão não identificada");
  assert.equal(installedVersion({ installed: { version: null } }), "Versão não identificada");
  assert.equal(installedVersion({ installed: { version: "0.0.4" } }), "v0.0.4");
  const out = renderToStaticMarkup(createElement(UpdatesReport, { report: { data: null, loading: false, error: "offline" }, onCheck: () => {}, onCopy: () => {}, notice: "Comando copiado.", busy: false }));
  assert.match(out, /Versão não identificada|role="alert"|offline|role="status"|Comando copiado/);
  assert.doesNotMatch(out, /v0\.0\.5|Em dia/);
});

test("remote freshness requires valid successful comparison metadata and expires", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  const data: UpdateStatus = { installed: { version: null, commit: "a".repeat(40) }, latest: { version: "0.0.5", commit: "b".repeat(40) }, status: "up_to_date", behind: 0, ahead: 0, checked_at: new Date(now).toISOString() };
  assert.equal(updateFreshness(data, now), "confirmed");
  assert.equal(updateFreshness(data, now + 16 * 60000), "stale");
  assert.equal(updateFreshness({ ...data, checked_at: "invalid" }, now), "unknown");
  assert.equal(updateFreshness({ ...data, checked_at: new Date(now + 60000).toISOString() }, now), "unknown");
  assert.equal(updateFreshness({ ...data, latest: null }, now), "unknown");
  assert.equal(updateFreshness({ ...data, ahead: null }, now), "unknown");
  assert.equal(updateFreshness({ ...data, behind: 2 }, now), "unknown");
  assert.equal(updateFreshness({ ...data, status: "unavailable", error: "rate_limited" }, now), "stale");
  assert.equal(updateFreshness({ ...data, status: "not_checked" }, now), "stale");
  const out = renderToStaticMarkup(createElement(UpdatesReport, { report: { data: { ...data, status: "unavailable", error: "rate_limited" }, loading: false, error: null }, now, onCheck: () => {}, onCopy: () => {}, busy: false }));
  assert.match(out, /Dados remotos anteriores|role="alert"|rate_limited/);
  assert.doesNotMatch(out, /Em dia com main|Última comparação confirmada/);
});
