/**
 * Model/token ledger — Milestone 6, Phase A (the accountability requirement).
 *
 * The fan-out runner (docs/run-deepseek-perf.sh) launches each worker with
 * `claude -p --output-format json` and tees the result JSON to
 * <worktree-dir>/<task-id>.json. This script reads every such JSON for per-task
 * token/turn/wall-time, and writes a Markdown table to stdout plus
 * docs/ledger-perf.json.
 *
 * IMPORTANT — where "backend" truth comes from:
 *   The per-worker `claude -p` JSON ALWAYS reports the local Anthropic envelope:
 *   a `claude-*` model id at Anthropic pricing, regardless of which backend the
 *   DeepClaude proxy actually routed the request to. So the per-task model id is
 *   "what Claude Code believes it ran", NOT proof of backend. The real backend +
 *   real (e.g. DeepSeek) pricing is only known to the proxy, exposed at
 *   GET /_proxy/cost. The runner snapshots that endpoint before/after fan-out and
 *   passes both here via --cost-before / --cost-after; this script diffs them to
 *   report the authoritative per-phase backend split. Without those snapshots the
 *   table still prints, but the backend column is labelled "reported" to make
 *   clear it's the local envelope, not proxy-confirmed routing.
 *   (See aattaran/deepclaude#39 for why the model id alone can't be trusted.)
 *
 * Usage:
 *   node scripts/ledger.mjs [dir] [--phase=B] [--out=docs/ledger-perf.json]
 *                           [--cost-before=FILE --cost-after=FILE]
 *   dir defaults to ../subfolio-astro-wt (where the runner tees worker JSON).
 *
 * Robust to plain text logs sitting alongside (.log) — only *.json is read, the
 * runner's _cost-*.json snapshots are skipped, and a non-result JSON is skipped
 * with a warning rather than aborting the ledger.
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
const COST_BEFORE = flags["cost-before"] || null;
const COST_AFTER = flags["cost-after"] || null;

/** The per-worker envelope's model id is what Claude Code *reports* locally; it
 * is a `claude-*` id even when the proxy routed to DeepSeek (see file header).
 * So this is NOT a backend proof — it's the reported tier. Authoritative backend
 * attribution comes from the /_proxy/cost delta instead (parseProxyDelta). */
function reportedBackendOf(model) {
  if (!model) return "unknown";
  return /^claude-/.test(model) ? "anthropic (reported)" : "deepseek (reported)";
}

/** Diff two /_proxy/cost snapshots (cumulative, per-backend) into this phase's
 * delta: { backend: { inputTokens, outputTokens, requests, costUSD,
 * anthropicEquivUSD } }. Returns null if either snapshot is missing/unreadable,
 * in which case the ledger falls back to the reported (local-envelope) view. */
function parseProxyDelta(beforePath, afterPath) {
  const read = (p) => {
    if (!p || !existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, "utf8"));
    } catch {
      return null;
    }
  };
  const before = read(beforePath);
  const after = read(afterPath);
  if (!after) return null;
  const b0 = before?.backends ?? {};
  const b1 = after?.backends ?? {};
  const delta = {};
  for (const [backend, a] of Object.entries(b1)) {
    const p = b0[backend] ?? {};
    const inTok = (a.input_tokens ?? 0) - (p.input_tokens ?? 0);
    const outTok = (a.output_tokens ?? 0) - (p.output_tokens ?? 0);
    const reqs = (a.requests ?? 0) - (p.requests ?? 0);
    const cost = (a.cost ?? 0) - (p.cost ?? 0);
    const anthEq = (a.anthropic_equivalent ?? 0) - (p.anthropic_equivalent ?? 0);
    // Only include backends that actually saw traffic in this window.
    if (reqs > 0 || inTok > 0 || outTok > 0 || cost > 0) {
      delta[backend] = {
        inputTokens: inTok,
        outputTokens: outTok,
        requests: reqs,
        costUSD: +cost.toFixed(6),
        anthropicEquivUSD: +anthEq.toFixed(6),
      };
    }
  }
  return delta;
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
    reportedBackend: reportedBackendOf(model),
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
    // Skip the runner's proxy-cost snapshots (_cost-before/_cost-after.json);
    // they're not worker result envelopes, they're the /_proxy/cost truth source.
    .filter((f) => f.endsWith(".json") && !f.startsWith("_cost-"))
    .map((f) => join(SCAN_DIR, f))
    .filter((f) => statSync(f).isFile())
    .sort();

  const rows = jsonFiles.map(parseResult).filter(Boolean);

  if (rows.length === 0) {
    console.log(`[ledger] no result JSON found in ${SCAN_DIR}`);
  }

  // --- aggregates ------------------------------------------------------------
  // byReportedTier groups by the LOCAL envelope (what Claude Code reported) — a
  // sanity view, NOT backend proof. proxyTruth (below) is the authoritative split.
  const byReportedTier = {};
  for (const r of rows) {
    const b = (byReportedTier[r.reportedBackend] ??= {
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

  // proxyTruth: the /_proxy/cost delta — the real backend + real pricing for this
  // phase. null when snapshots weren't passed (runner not updated, or a manual run).
  const proxyTruth = parseProxyDelta(COST_BEFORE, COST_AFTER);

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
    byReportedTier,
    proxyTruth, // authoritative backend/cost split, or null if no snapshots
    totals,
  };
  writeFileSync(OUT, JSON.stringify(report, null, 2));

  // --- Markdown table to stdout ---------------------------------------------
  const md = [];
  md.push(`### Model / token ledger${PHASE ? ` — Phase ${PHASE}` : ""}`);
  md.push("");
  md.push("| Task | Reported tier | Model (local envelope) | In | Out | Turns | Cost* | Status |");
  md.push("|---|---|---|--:|--:|--:|--:|---|");
  for (const r of rows) {
    md.push(
      `| ${r.task} | ${r.reportedBackend} | ${r.model} | ${r.inputTokens} | ${r.outputTokens} | ${r.numTurns} | ${usd(r.costUSD)} | ${r.isError ? "ERROR" : "ok"} |`,
    );
  }
  md.push("");
  md.push(
    "\\* *Cost/model here are the LOCAL `claude -p` envelope (Anthropic-priced), " +
      "NOT proof of which backend served the request — see the proxy-truth block below.*",
  );
  md.push("");

  // --- proxy truth (authoritative) ------------------------------------------
  md.push("**Backend split (proxy truth — /_proxy/cost delta):**");
  if (proxyTruth && Object.keys(proxyTruth).length > 0) {
    for (const [backend, v] of Object.entries(proxyTruth)) {
      const saved = v.anthropicEquivUSD - v.costUSD;
      md.push(
        `- **${backend}**: ${v.requests} request(s), ${v.inputTokens} in / ${v.outputTokens} out, ` +
          `actual ${usd(v.costUSD)} vs Anthropic-equiv ${usd(v.anthropicEquivUSD)} ` +
          `(saved ${usd(saved)})`,
      );
    }
  } else {
    md.push(
      "- _(no proxy-cost snapshots — run via docs/run-deepseek-perf.sh, which passes " +
        "--cost-before/--cost-after. Backend routing is UNVERIFIED for this run.)_",
    );
  }
  md.push("");
  md.push("**Reported-tier tally (local envelope, sanity only):**");
  for (const [b, v] of Object.entries(byReportedTier)) {
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
