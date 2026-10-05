import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CodexDeviceChallenge } from "../src/components/codex-device-challenge.tsx";

const html = (login: Parameters<typeof CodexDeviceChallenge>[0]["login"]) => renderToStaticMarkup(createElement(CodexDeviceChallenge, { login, onCancel: () => {} }));

test("new installations show the official Codex device URL, their temporary code and cancellation", () => {
  const out = html({ status: "awaiting_user", verification_url: "https://auth.openai.com/codex/device", user_code: "ABCD-12345" });
  assert.match(out, /href="https:\/\/auth\.openai\.com\/codex\/device"/);
  assert.match(out, /ABCD-12345/);
  assert.match(out, /Cancelar login/);
  assert.match(out, /rel="noopener noreferrer"/);
});

test("the panel never links arbitrary login output or treats a challenge as authenticated", () => {
  for (const url of ["https://auth.openai.com.evil/codex/device", "https://auth.openai.com/codex/device?token=private", "javascript:alert(1)"])
    assert.doesNotMatch(html({ status: "awaiting_user", verification_url: url, user_code: "ABCD-12345" }), /href=/);
  assert.doesNotMatch(html({ status: "awaiting_user", verification_url: "https://auth.openai.com/codex/device", user_code: "private-invalid-code" }), /private-invalid-code|href=/);
  assert.equal(html({ status: "idle" }), "");
  assert.match(html({ status: "approval_required" }), /autenticação existente/);
});
