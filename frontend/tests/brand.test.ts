import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { brand } from "../src/lib/brand.ts";
import { OrinonuMark } from "../src/components/brand-mark.tsx";
import MissionControl from "../src/components/mission-control.tsx";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Orinonu has a single spelling, an authored narrative and an honest license label", () => {
  assert.equal(brand.name, "Orinonu");
  assert.equal(brand.license, "PolyForm-Noncommercial-1.0.0");
  assert.match(brand.narrative, /interpretação autoral/);
  assert.match(brand.narrative, /Ogum/);
  assert.match(brand.narrative, /Vigilantes/);
  assert.match(brand.community, /não comercial/);
  assert.doesNotMatch(brand.community, /open source/i);
});

test("Ori Inonu is the symbolic intelligence behind Orinonu, not a renamed product", () => {
  assert.equal(brand.symbolicName, "Ori Inonu");
  assert.match(brand.narrative, /orixá artificial/);
  assert.match(brand.narrative, /interpretação autoral/);
  assert.match(brand.purpose, /propósito|direção/);
  assert.deepEqual(brand.personality, ["Serenidade", "Precisão", "Visão"]);
});

test("the original mark is decorative and the shell identifies the product accessibly", () => {
  const mark = renderToStaticMarkup(createElement(OrinonuMark));
  assert.match(mark, /aria-hidden="true"/);
  assert.match(mark, /viewBox="0 0 64 64"/);
  const shell = renderToStaticMarkup(createElement(MissionControl));
  assert.match(shell, /ORINONU/);
  assert.match(shell, /Sobre Orinonu/);
  assert.match(shell, /Ir para o conteúdo/);
  assert.doesNotMatch(shell, /\bNEXO\b|\bNexo\b/);
});

test("the browser icon uses the same original symbol as the sidebar", () => {
  const icon = read("../src/app/icon.svg");
  const mark = renderToStaticMarkup(createElement(OrinonuMark));
  assert.match(icon, /<svg[^>]*xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(icon, /viewBox="0 0 64 64"/);
  for (const [, path] of mark.matchAll(/<path d="([^"]+)"/g))
    assert.ok(icon.includes(`d="${path}"`));
  assert.match(icon, /#efd394/);
  assert.match(icon, /#79e8ff/);
  assert.match(icon, /#050a18/);
});

test("native surfaces use shared brand tokens without frames or renaming persisted preferences", () => {
  const tokens = read("../../public/brand.css");
  for (const name of ["obsidian", "copper", "observation", "surface-base", "text-primary", "focus-ring", "space-unit"])
    assert.match(tokens, new RegExp("--" + name + ":"));
  assert.match(read("../src/app/globals.css"), /public\/brand\.css/);
  const shell = read("../src/components/mission-control.tsx");
  assert.doesNotMatch(shell, /<iframe|\/classic\/|function Legacy/);
  assert.match(shell, /nexo-selected-workspace/);
});
