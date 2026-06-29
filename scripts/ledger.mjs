/**
 * Model/token ledger — Milestone 6, Phase A (the accountability requirement).
 *
 * The fan-out runner (docs/run-deepseek-perf.sh) launches each worker with
 * `claude -p --output-format json` and tees the result JSON to
 * <worktree-dir>/<task-id>.json. This script reads every such JSON, extracts the
 * backend/model, token usage, cost, turns and wall-time per task, and writes a
 * Markdown table to stdout plus docs/ledger-perf.json. Because each run records
 * its own model id, the DeepSeek-vs-Anthropic split is PROVABLE per phase — and
 * Opus-run tasks (different model id) show up in the same table.
 *
 * Usage:
 *   node scripts/ledger.mjs [dir] [--phase=B] [--out=docs/ledger-perf.json]
 *   dir defaults to ../subfolio-astro-wt (where the runner tees worker JSON).
 *
 * Robust to plain text logs sitting alongside (.log) — only *.json is read, and a
 * non-result JSON is skipped with a warning rather than aborting the ledger.
 */
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
} from "node:fs";
import { resolve, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

const args = process.argv.slice(2);
const flags = Object.fromEntries(
  args.filter((a) => a.startsWith("--")).map((a) => {
    const [k, v = true] = a.replace(/^--/, "").split("=");
    return [k, v];
  }),
);
const dirArg = args.find((a) => !a.startsWith("--"));
const SCAN_DIR = resolve(dirArg ?? join(ROOT, "../subfolio-astro-wt"));
const OUT = resolve(ROOT, flags.out ?? "docs/ledger-perf.json");
const PHASE = flags.phase ?? "";

/** Anthropic model ids start with "claude-"; everything else is the DeepSeek
 * backend (the proxy reports its upstream id, e.g. "deepseek-chat"). */
function backendOf(model) {
  if (!model) return "unknown";
  return /^claude-/.test(model) ? "anthropic" : "deepseek";
}

const KB = (n) => `${(n / 1024).toFixed(1)} KB`;
const usd = (n) => `$${(n ?? 0).toFixed(4)}`;

function parseResult(abs) {
  let json;
  try {
    json = JSON.parse(readFileSync(abs, "utf8"));
  } catch {
    console.warn(`[ledger] skip (not JSON): ${basename(abs)}`);
    return null;
  }
  if (json?.type !== "result") {
    console.warn(`[ledger] skip (no result envelope): ${basename(abs)}`);
    return null;
  }
  // modelUsage is keyed by model id; pick the dominant one (most output tokens).
  const modelUsage = json.modelUsage ?? {};
  const model =
    Object.entries(modelUsage).sort(
      (a, b) => (b[1].outputTokens ?? 0) - (a[1].outputTokens ?? 0),
    )[0]?.[0] ?? "unknown";
  const u = json.usage ?? {};
  return {
    task: basename(abs, ".json"),
    model,
    backend: backendOf(model),
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheCreateTokens: u.cache_creation_input_tokens ?? 0,
    costUSD: json.total_cost_usd ?? 0,
    numTurns: json.num_turns ?? 0,
    durationMs: json.duration_ms ?? 0,
    isError: !!json.is_error,
  };
}

function main() {
  if (!existsSync(SCAN_DIR)) {
    console.error(
      `[ledger] scan dir not found: ${SCAN_DIR}\n` +
        `         (the runner tees worker JSON here; nothing to ledger yet).`,
    );
    return; // not an error — there may simply be no fan-out yet
  }

  const jsonFiles = readdirSync(SCAN_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => join(SCAN_DIR, f))
    .filter((f) => statSync(f).isFile())
    .sort();

  const rows = jsonFiles.map(parseResult).filter(Boolean);

  if (rows.length === 0) {
    console.log(`[ledger] no result JSON found in ${SCAN_DIR}`);
  }

  // --- aggregates ------------------------------------------------------------
  const byBackend = {};
  for (const r of rows) {
    const b = (byBackend[r.backend] ??= {
      tasks: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUSD: 0,
    });
    b.tasks++;
    b.inputTokens += r.inputTokens;
    b.outputTokens += r.outputTokens;
    b.costUSD += r.costUSD;
  }
  const totals = rows.reduce(
    (t, r) => {
      t.tasks++;
      t.inputTokens += r.inputTokens;
      t.outputTokens += r.outputTokens;
      t.costUSD += r.costUSD;
      t.durationMs += r.durationMs;
      return t;
    },
    { tasks: 0, inputTokens: 0, outputTokens: 0, costUSD: 0, durationMs: 0 },
  );

  const report = {
    generatedAt: new Date().toISOString(),
    phase: PHASE,
    scanDir: SCAN_DIR,
    tasks: rows,
    byBackend,
    totals,
  };
  writeFileSync(OUT, JSON.stringify(report, null, 2));

  // --- Markdown table to stdout ---------------------------------------------
  const md = [];
  md.push(`### Model / token ledger${PHASE ? ` — Phase ${PHASE}` : ""}`);
  md.push("");
  md.push("| Task | Backend | Model | In | Out | Turns | Cost | Status |");
  md.push("|---|---|---|--:|--:|--:|--:|---|");
  for (const r of rows) {
    md.push(
      `| ${r.task} | ${r.backend} | ${r.model} | ${r.inputTokens} | ${r.outputTokens} | ${r.numTurns} | ${usd(r.costUSD)} | ${r.isError ? "ERROR" : "ok"} |`,
    );
  }
  md.push("");
  md.push("**Split by backend:**");
  for (const [b, v] of Object.entries(byBackend)) {
    md.push(
      `- ${b}: ${v.tasks} task(s), ${v.inputTokens} in / ${v.outputTokens} out, ${usd(v.costUSD)}`,
    );
  }
  md.push(
    `- **Total:** ${totals.tasks} task(s), ${totals.inputTokens} in / ${totals.outputTokens} out, ${usd(totals.costUSD)}, ${(totals.durationMs / 1000).toFixed(1)}s wall`,
  );
  const table = md.join("\n");
  console.log("\n" + table + "\n");
  console.log(`Wrote ${flags.out ?? "docs/ledger-perf.json"}`);

  return table;
}

main();
