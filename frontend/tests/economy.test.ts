import test from "node:test";
import assert from "node:assert/strict";
import {
  brlFrom,
  economySummary,
  formatBrl,
  formatSeconds,
  formatTokens,
  formatUsd,
  repoLabel,
  sumKnown,
  type Analytics,
  type Comparison,
} from "../src/lib/mission.ts";

const plain = (value: string) => value.replace(/\u00a0/g, " ");

test("conversion requires a positive quote and never invents values", () => {
  assert.equal(brlFrom(0.0084, 5.42), 0.045528);
  assert.equal(brlFrom(0, 5.42), 0);
  assert.equal(brlFrom(0.0084, null), null);
  assert.equal(brlFrom(null, 5.42), null);
  assert.equal(brlFrom(0.0084, 0), null);
  assert.equal(brlFrom(0.0084, -5), null);
  assert.equal(brlFrom(Number.NaN, 5.42), null);
  assert.equal(sumKnown([1, 2]), 3);
  assert.equal(sumKnown([1, null]), null);
  assert.equal(sumKnown([]), null);
});

test("cost formatting keeps fractions of a real readable", () => {
  assert.equal(plain(formatBrl(0.04610252)), "R$ 0,046103");
  assert.equal(plain(formatBrl(0)), "R$ 0,00");
  assert.equal(plain(formatBrl(1234.567)), "R$ 1.234,57");
  assert.equal(plain(formatBrl(null)), "—");
  assert.equal(plain(formatUsd(0.00057452)), "US$ 0,000575");
  assert.equal(plain(formatTokens(3100)), "3.100");
  assert.equal(plain(formatTokens(null)), "—");
  assert.equal(formatSeconds(45), "45 s");
  assert.equal(formatSeconds(300), "5 min");
  assert.equal(formatSeconds(3725), "1 h 2 min");
  assert.equal(formatSeconds(null), "—");
});

test("reference links show the repository name and degrade to the raw value", () => {
  assert.equal(repoLabel("https://github.com/andymik90/aperant"), "andymik90/aperant");
  assert.equal(
    repoLabel("https://github.com/paperclipai/paperclip.git"),
    "paperclipai/paperclip",
  );
  assert.equal(repoLabel("https://github.com/stablyai/orca/"), "stablyai/orca");
  assert.equal(repoLabel("not-a-url"), "not-a-url");
});

test("economy summary uses the server quote and converts every estimate", () => {
  const analytics: Analytics = {
    currency: {
      source: "https://economia.awesomeapi.com.br/json/last/USD-BRL",
      usd_brl: 5.42,
      fetched_at: "2026-10-04T20:00:00Z",
      status: "available",
    },
    jev: {
      input_tokens: 100,
      output_tokens: 2,
      estimated_usd: 0.000106,
      estimated_brl: 0.00057452,
      cached_calls: 1,
      unpriced_calls: 0,
    },
    executor: {
      input_tokens: 3000,
      output_tokens: 300,
      estimated_usd: 0.0084,
      estimated_brl: 0.045528,
      unpriced_calls: 0,
    },
    totals: {
      estimated_usd: 0.008506,
      estimated_brl: 0.04610252,
      input_tokens: 3100,
      output_tokens: 302,
      seconds: 3,
      unpriced_calls: 0,
    },
    simulations: [
      {
        model: "openai/worker",
        estimated_usd: 0.002,
        jev_estimated_usd: 0.000106,
        difference_usd: 0.001894,
        difference_brl: 0.01026548,
      },
    ],
    tasks: [
      {
        task_id: "t1",
        title: "Missão medida",
        model: "worker",
        estimated_usd: 0.008506,
        seconds: 3,
      },
      { task_id: "t2", title: "Sem preço", model: "absent", estimated_usd: null },
    ],
  };
  const summary = economySummary(analytics, { jev_calls: 3, jev_cached: 1 }, {
    controlled_pairs: 12,
    proven_saved_usd: 0.25,
    proven_saved_seconds: 120,
    assessment: { status: "eligible", reasons: [] },
  });
  assert.equal(summary.rate, 5.42);
  assert.equal(summary.rateStatus, "available");
  assert.equal(summary.totalBrl, 0.04610252);
  assert.equal(summary.inputTokens, 3100);
  assert.equal(summary.outputTokens, 302);
  assert.equal(summary.seconds, 3);
  assert.equal(summary.jevCalls, 3);
  assert.equal(summary.cachedCalls, 1);
  assert.deepEqual(
    summary.missions.map((row) => [row.id, row.brl]),
    [
      ["t1", 0.04610252],
      ["t2", null],
    ],
  );
  assert.equal(summary.measured.status, "measured");
  assert.equal(summary.measured.brl, brlFrom(0.25, 5.42));
  assert.equal(summary.measured.seconds, 120);
  assert.equal(summary.simulations[0].difference_brl, 0.01026548);
});

test("economy summary keeps unknown totals unknown and derives them from an older server", () => {
  const legacy: Analytics = {
    jev: { input_tokens: 100, output_tokens: 2, estimated_usd: 0.000106, unpriced_calls: 0 },
    executor: { input_tokens: 3000, output_tokens: 300, estimated_usd: 0.0084, unpriced_calls: 0 },
    tasks: [
      { task_id: "t", title: "T", estimated_usd: 0.008506, seconds: 3 },
    ],
  };
  const missing = economySummary(legacy, {}, undefined);
  assert.equal(missing.rate, null);
  assert.equal(missing.rateStatus, "missing");
  assert.equal(missing.totalUsd, 0.008506);
  assert.equal(missing.totalBrl, null);
  assert.equal(missing.missions[0].brl, null);
  assert.equal(missing.measured.status, "pending");
  assert.equal(missing.measured.brl, null);

  const quoted = economySummary(legacy, { saved_usd: null }, undefined);
  assert.equal(quoted.rateStatus, "missing");
  const unknown = economySummary(
    { ...legacy, jev: { ...legacy.jev, estimated_usd: null } },
    {},
    undefined,
  );
  assert.equal(unknown.totalUsd, null);
  assert.equal(unknown.totalBrl, null);
});

test("measured savings distinguish regression and neutral outcomes", () => {
  const base: Comparison = {
    controlled_pairs: 12,
    proven_saved_usd: -0.4,
    proven_saved_seconds: -30,
    regressions: 1,
  };
  const regression = economySummary(undefined, {}, base);
  assert.equal(regression.measured.status, "regression");
  assert.equal(regression.measured.brl, null);
  const neutral = economySummary(undefined, { saved_brl: 0 }, {
    controlled_pairs: 10,
    proven_saved_usd: 0,
    proven_saved_seconds: 0,
  });
  assert.equal(neutral.measured.status, "neutral");
  assert.equal(neutral.measured.brl, 0);
});
