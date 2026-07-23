/**
 * Perf-budget harness test — Milestone 6, Phase A.
 *
 * Asserts the SHAPE of the report scripts/perf-budget.mjs writes (so later
 * phases can trust the JSON they read deltas from), and surfaces soft-ceiling
 * breaches as `WARN` console lines that DO NOT fail the test — mirroring the
 * harness's own warn-only posture (plans/zippy-coalescing-rainbow.md "measure,
 * don't block"). Only structural breakage fails here.
 *
 * Depends on dist/perf-budget.json existing, which means the harness must have
 * run against a build. Run:  npm run perf && node --test tests/perf.budget.test.mjs
 * (or `npm run test:perf`). Mirrors tests/smoke.routes.test.mjs conventions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { DIST } from "./_dist.mjs";

const REPORT = join(DIST, "perf-budget.json");

test("perf-budget.json exists (run `npm run perf` first)", () => {
  assert.ok(
    existsSync(REPORT),
    "dist/perf-budget.json missing — run `npm run perf` to generate it",
  );
});

// Everything below depends on the report; load it once.
const report = existsSync(REPORT)
  ? JSON.parse(readFileSync(REPORT, "utf8"))
  : null;

test("report has the expected top-level shape", () => {
  assert.ok(report, "no report to assert against");
  for (const key of [
    "generatedAt",
    "pages",
    "linkedAssets",
    "fonts",
    "images",
    "largestAssets",
    "budgets",
  ]) {
    assert.ok(key in report, `report missing "${key}"`);
  }
});

test("pages section counts at least the fixture routes", { skip: !report }, () => {
  assert.ok(report.pages.count >= 14, `only ${report.pages.count} pages built`);
  assert.ok(report.pages.htmlBytesTotal > 0, "htmlBytesTotal is zero");
  assert.ok(report.pages.largest.bytes > 0, "largest page has zero bytes");
});

test("linked assets include main.css and main.js", { skip: !report }, () => {
  const paths = report.linkedAssets.map((a) => a.path);
  assert.ok(paths.includes("css/main.css"), "css/main.css not linked");
  assert.ok(paths.includes("js/main.js"), "js/main.js not linked");
  for (const a of report.linkedAssets) {
    assert.ok(a.bytes > 0, `linked asset ${a.path} reported zero bytes`);
  }
});

test("fonts + images sections carry per-format/ext breakdowns", { skip: !report }, () => {
  assert.equal(typeof report.fonts.totalBytes, "number");
  assert.ok(report.fonts.byFormat && typeof report.fonts.byFormat === "object");
  assert.equal(typeof report.images.totalBytes, "number");
  assert.ok(report.images.byExt && typeof report.images.byExt === "object");
});

test("every budget row has a status, and breaches are WARN-only", { skip: !report }, () => {
  assert.ok(Array.isArray(report.budgets) && report.budgets.length > 0);
  for (const b of report.budgets) {
    assert.ok(["OK", "WARN"].includes(b.status), `bad status: ${b.status}`);
    assert.equal(typeof b.actual, "number");
    assert.equal(typeof b.ceiling, "number");
    if (b.status === "WARN") {
      // Logged, not failed — this is the whole point of "measure, don't block".
      console.log(
        `WARN  budget "${b.name}" over: ${(b.actual / 1024).toFixed(1)} KB ` +
          `> ${(b.ceiling / 1024).toFixed(1)} KB`,
      );
    }
  }
});
