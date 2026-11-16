/**
 * Offline evaluation: could TypeSafe's Jev ("System One" decision model) do the
 * positivity filter's accept/reject call?
 *
 * Read-only against a COPY of the production DB, and it never calls Anthropic —
 * the Haiku baseline is what the pipeline already stored. Two labelled sets:
 *
 *   taste   raw_articles approved/discarded — Rik's own decisions on what the
 *           filter let through. Measures whether Jev ranks his approvals above
 *           his discards better than Haiku's stored positivity_score does.
 *   funnel  raw_articles (Haiku said YES) + a sample of rejected_articles
 *           (Haiku said NO). Measures how far Jev agrees with today's filter.
 *
 * The latest 7 days are reported separately as a held-out week: tune the
 * criteria wording below on the older data only, then read the held-out number.
 *
 * Every answer is cached in <out>/cache.jsonl, so re-runs only pay for articles
 * or questions that changed.
 *
 * Usage (from admin/):
 *   node --env-file=.env.local --experimental-strip-types scripts/eval-jev.ts --db /path/to/positron.db --dry-run
 *   node --env-file=.env.local --experimental-strip-types scripts/eval-jev.ts --db /path/to/positron.db
 *
 * Options: --out <dir> (default ./jev-eval), --rejected <n> (default 600),
 * --model <name> (default jev-latest), --repeat <n> articles re-asked twice
 * more to check determinism (default 40). Needs TYPESAFE_API_KEY.
 */

import { createClient } from "@libsql/client";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ── CLI ─────────────────────────────────────────────────────────────────────

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const DB_PATH = arg("db");
const OUT = resolve(arg("out", "jev-eval")!);
const REJECTED_SAMPLE = Number(arg("rejected", "600"));
const MODEL = arg("model", "jev-latest")!;
const REPEAT = Number(arg("repeat", "40"));
const DRY_RUN = process.argv.includes("--dry-run");

const API_URL = process.env.JEV_API_URL ?? "https://api.typesafe.ai/v1/systemone";   // override to point at a mock
const API_KEY = process.env.TYPESAFE_API_KEY;
const USD_PER_M_INPUT = 0.042;   // TypeSafe list price; output tokens are free
const CONCURRENCY = 8;
const MAX_SNIPPET_CHARS = 1000;   // same cap as classify-batch.ts
const HOLDOUT_DAYS = 7;

if (!DB_PATH) {
  console.error("--db <path to a copy of positron.db> is required");
  process.exit(1);
}
if (!DRY_RUN && !API_KEY) {
  console.error("TYPESAFE_API_KEY is not set (add it to admin/.env.local), or pass --dry-run");
  process.exit(1);
}

// ── Questions ───────────────────────────────────────────────────────────────
// Jev reads criteria literally, so each one states a checkable condition.
// `accept` condenses DEFAULT_FILTER_INSTRUCTIONS; `taste` describes what Rik
// actually approves; the rest are single rules, for diagnosing disagreements.

const QUESTIONS = {
  accept: {
    type: "noul",
    instructions: "Does this news article belong on Positron.today, a strict positive-news site for an international readership?",
    criteria: {
      true: "A good thing that has already happened and is confirmed (an established finding, a deployed technology, an approved treatment, a measured real-world change, a genuine first), that matters to a reader anywhere in the world, and that teaches something about how the world works.",
      false: "Any of: sports results or sports business; significance limited to one town, city or region; celebrities or entertainment, including a famous person's charity; corporate PR, product launches, funding, or a company's own good deeds; routine tech releases; politics or government decisions; viral cute or emotional moments without substance; one person's inspiring story; good news that only exists because something bad happened first; event photo roundups or how-to-watch pieces; reviews and lifestyle; a hedged or unproven finding, an early or small study, or a benefit that 'could', 'may' or 'paves the way' but has not arrived; plans and announcements of things not yet done.",
    },
  },
  taste: {
    type: "noul",
    instructions: "Would the editor of a positive-news site approve this article for publication?",
    criteria: {
      true: "Science, nature, environment, medicine, or human achievement with a concrete positive result that a curious reader anywhere would find uplifting and new, including well-reported research findings.",
      false: "Business and economy news, politics, corporate deals, sports, or a story that is mainly about one particular place.",
    },
  },
  sports: { type: "noul", instructions: "Is this article mainly about professional sports (results, standings, transfers, athletes, sports business)?" },
  local_only: { type: "noul", instructions: "Does this article's significance depend on caring about one particular town, city, or region?" },
  celebrity: { type: "noul", instructions: "Is this article newsworthy mainly because a celebrity or famous person is involved?" },
  corporate_pr: { type: "noul", instructions: "Is this article a company's announcement, product launch, funding round, earnings, partnership, or publicised good deed?" },
  politics: { type: "noul", instructions: "Is this article mainly about politics, elections, legislation, or a government decision?" },
  hedged: {
    type: "noul",
    instructions: "Is the article's central good news a possibility rather than an established result?",
    criteria: {
      true: "The finding itself is hedged (may, might, possible, suggests, a question in the headline), or the benefit is in the future (could lead to, paves the way, one step closer, raises hopes), or it is a plan, pledge, early-stage or small study, model or simulation.",
      false: "The good thing has already happened and been observed, measured, approved, or deployed, even if the wording is cautious.",
    },
  },
} as const;

const QUESTIONS_HASH = createHash("sha256").update(MODEL + JSON.stringify(QUESTIONS)).digest("hex").slice(0, 12);

// ── Data ────────────────────────────────────────────────────────────────────

interface Item {
  key: string;              // "raw:123" / "rej:456"
  title: string;
  snippet: string;
  fetchedAt: string;
  haikuPassed: boolean;     // raw_articles = filter said YES
  haikuScore: number | null;
  rikApproved: boolean | null;
  repeat: boolean;          // folded into an earlier story (v4.4.0+)
  category: string | null;  // rejection_category for rejected items
}

/** Cut on a sentence boundary — a mid-sentence cut reads as "still in development". */
function trimSnippet(text: string | null): string {
  const t = (text ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (t.length <= MAX_SNIPPET_CHARS) return t;
  const cut = t.slice(0, MAX_SNIPPET_CHARS);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > 200 ? cut.slice(0, end + 1) : cut;
}

async function loadItems(): Promise<Item[]> {
  const db = createClient({ url: `file:${resolve(DB_PATH!)}` });
  const cols = async (table: string) =>
    new Set((await db.execute(`PRAGMA table_info(${table})`)).rows.map((r) => String(r.name)));
  const rawCols = await cols("raw_articles");
  const rejCols = await cols("rejected_articles");

  const storyExpr = rawCols.has("story_id")
    ? `(r.story_id IS NOT NULL AND EXISTS (SELECT 1 FROM raw_articles e WHERE e.story_id = r.story_id AND e.id < r.id))`
    : "0";
  const raw = await db.execute(`
    SELECT r.id, r.title, r.content, r.fetched_at, r.status, r.positivity_score, ${storyExpr} AS is_repeat
    FROM raw_articles r
    WHERE r.status IN ('approved', 'discarded')
    ORDER BY r.fetched_at`);

  const rej = await db.execute({
    sql: `SELECT id, title, snippet, fetched_at,
            ${rejCols.has("positivity_score") ? "positivity_score" : "NULL AS positivity_score"},
            ${rejCols.has("rejection_category") ? "rejection_category" : "NULL AS rejection_category"}
          FROM rejected_articles ORDER BY fetched_at DESC LIMIT ?`,
    args: [REJECTED_SAMPLE],
  });
  db.close();

  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return [
    ...raw.rows.map((r): Item => ({
      key: `raw:${r.id}`, title: String(r.title), snippet: trimSnippet(r.content as string | null),
      fetchedAt: String(r.fetched_at), haikuPassed: true, haikuScore: num(r.positivity_score),
      rikApproved: r.status === "approved", repeat: Number(r.is_repeat) === 1, category: null,
    })),
    ...rej.rows.map((r): Item => ({
      key: `rej:${r.id}`, title: String(r.title), snippet: trimSnippet(r.snippet as string | null),
      fetchedAt: String(r.fetched_at), haikuPassed: false, haikuScore: num(r.positivity_score),
      rikApproved: null, repeat: false, category: (r.rejection_category as string | null) ?? null,
    })),
  ];
}

// ── API ─────────────────────────────────────────────────────────────────────

type Answers = Record<keyof typeof QUESTIONS, number>;
interface CacheRow { key: string; qh: string; rep: number; answers: Answers; tokens: number }

const state = (it: Item) => ({ headline: it.title, snippet: it.snippet });

async function ask(it: Item): Promise<{ answers: Answers; tokens: number }> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, state: state(it), questions: QUESTIONS }),
    });
    if (res.ok) {
      const body = await res.json() as { answers: Record<string, { noul: number }>; usage?: { input_tokens: number } };
      const answers = Object.fromEntries(
        Object.keys(QUESTIONS).map((q) => [q, Number(body.answers[q]?.noul)]),
      ) as Answers;
      return { answers, tokens: body.usage?.input_tokens ?? 0 };
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 5) {
      throw new Error(`Jev ${res.status} for ${it.key}: ${(await res.text()).slice(0, 500)}`);
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
}

async function pool<T>(items: T[], fn: (t: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

// ── Metrics ─────────────────────────────────────────────────────────────────

/** ROC AUC via rank sum; ties count half. 0.5 = coin flip, 1.0 = perfect ranking. */
function auc(scores: number[], labels: boolean[]): number {
  const idx = scores.map((s, i) => [s, labels[i]] as const).sort((a, b) => a[0] - b[0]);
  let rankSum = 0, pos = 0, i = 0;
  while (i < idx.length) {
    let j = i;
    while (j < idx.length && idx[j][0] === idx[i][0]) j++;
    const avgRank = (i + j + 1) / 2;
    for (let k = i; k < j; k++) if (idx[k][1]) { rankSum += avgRank; pos++; }
    i = j;
  }
  const neg = idx.length - pos;
  return pos && neg ? (rankSum - (pos * (pos + 1)) / 2) / (pos * neg) : NaN;
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : "–");
const f2 = (n: number) => (Number.isFinite(n) ? n.toFixed(3) : "–");

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(OUT, { recursive: true });
  const items = await loadItems();
  const latest = items.reduce((m, it) => (it.fetchedAt > m ? it.fetchedAt : m), "");
  const holdoutFrom = new Date(new Date(latest.replace(" ", "T") + "Z").getTime() - HOLDOUT_DAYS * 864e5)
    .toISOString().replace("T", " ").slice(0, 19);
  const isHoldout = (it: Item) => it.fetchedAt >= holdoutFrom;

  const repeatKeys = new Set(items.slice(0, REPEAT).map((it) => it.key));
  const jobs = items.flatMap((it) => [0, ...(repeatKeys.has(it.key) ? [1, 2] : [])].map((rep) => ({ it, rep })));

  const approxTokens = jobs.reduce((n, j) => n + (JSON.stringify(state(j.it)).length + JSON.stringify(QUESTIONS).length) / 4, 0);
  console.log(`${items.filter((i) => i.haikuPassed).length} Rik-labelled articles, ${items.filter((i) => !i.haikuPassed).length} filter rejects, ${jobs.length} requests`);
  console.log(`held-out week from ${holdoutFrom}`);
  console.log(`estimated ~${Math.round(approxTokens / 1000)}k input tokens ≈ $${((approxTokens / 1e6) * USD_PER_M_INPUT).toFixed(2)} before cache hits`);

  if (DRY_RUN) {
    console.log("\nSample request body:\n" + JSON.stringify({ model: MODEL, state: state(items[0]), questions: QUESTIONS }, null, 2));
    return;
  }

  // Cache
  const cachePath = `${OUT}/cache.jsonl`;
  const cache = new Map<string, CacheRow>();
  if (existsSync(cachePath)) {
    for (const line of readFileSync(cachePath, "utf8").split("\n").filter(Boolean)) {
      const row = JSON.parse(line) as CacheRow;
      cache.set(`${row.key}|${row.qh}|${row.rep}`, row);
    }
  }
  const todo = jobs.filter((j) => !cache.has(`${j.it.key}|${QUESTIONS_HASH}|${j.rep}`));
  console.log(`${jobs.length - todo.length} cached, ${todo.length} to ask`);

  let done = 0, failed = 0;
  await pool(todo, async ({ it, rep }) => {
    try {
      const { answers, tokens } = await ask(it);
      const row: CacheRow = { key: it.key, qh: QUESTIONS_HASH, rep, answers, tokens };
      cache.set(`${it.key}|${QUESTIONS_HASH}|${rep}`, row);
      appendFileSync(cachePath, JSON.stringify(row) + "\n");
    } catch (e) {
      failed++;
      if (failed <= 5) console.error(String(e));
    }
    if (++done % 100 === 0) console.log(`  ${done}/${todo.length}`);
  });

  const get = (it: Item, rep = 0) => cache.get(`${it.key}|${QUESTIONS_HASH}|${rep}`)?.answers;
  const scored = items.filter((it) => get(it));
  const tokens = [...cache.values()].filter((r) => r.qh === QUESTIONS_HASH).reduce((n, r) => n + r.tokens, 0);

  // Report
  const L: string[] = [];
  L.push(`# Jev filter evaluation`, ``,
    `Model \`${MODEL}\`, questions ${QUESTIONS_HASH}, run ${new Date().toISOString().slice(0, 16)}.`,
    `${scored.length}/${items.length} articles scored, ${failed} failed. ${tokens.toLocaleString()} input tokens ≈ $${((tokens / 1e6) * USD_PER_M_INPUT).toFixed(3)}.`,
    `Held-out week: fetched from ${holdoutFrom}.`, ``);

  // 1. Taste: Rik's approve/discard on what the filter let through
  L.push(`## 1. Rik's decisions (articles that passed the filter)`, ``,
    `AUC = chance that a random approved article is ranked above a random discarded one. 0.5 is a coin flip.`, ``,
    `| subset | n | approved | Haiku score | Jev accept | Jev taste |`, `|---|---|---|---|---|---|`);
  const taste = scored.filter((it) => it.rikApproved !== null);
  const subsets: [string, Item[]][] = [
    ["all, tuning weeks", taste.filter((it) => !isHoldout(it))],
    ["all, held-out week", taste.filter(isHoldout)],
    ["excl. repeats, tuning", taste.filter((it) => !isHoldout(it) && !it.repeat)],
    ["excl. repeats, held-out", taste.filter((it) => isHoldout(it) && !it.repeat)],
  ];
  for (const [name, set] of subsets) {
    const y = set.map((it) => it.rikApproved!);
    const withScore = set.filter((it) => it.haikuScore !== null);
    L.push(`| ${name} | ${set.length} | ${pct(y.filter(Boolean).length, y.length)} | ${f2(auc(withScore.map((it) => it.haikuScore!), withScore.map((it) => it.rikApproved!)))} | ${f2(auc(set.map((it) => get(it)!.accept), y))} | ${f2(auc(set.map((it) => get(it)!.taste), y))} |`);
  }

  L.push(``, `### What a Jev gate would do to the Preview queue (held-out week, repeats excluded)`, ``,
    `| threshold on accept | approvals kept | discards removed | queue size |`, `|---|---|---|---|`);
  const hq = taste.filter((it) => isHoldout(it) && !it.repeat);
  for (const t of [0.2, 0.3, 0.4, 0.5, 0.6, 0.7]) {
    const kept = hq.filter((it) => get(it)!.accept >= t);
    const appr = hq.filter((it) => it.rikApproved).length, disc = hq.length - appr;
    L.push(`| ${t} | ${pct(kept.filter((it) => it.rikApproved).length, appr)} | ${pct(disc - kept.filter((it) => !it.rikApproved).length, disc)} | ${kept.length}/${hq.length} |`);
  }

  // 2. Funnel: agreement with today's Haiku filter
  L.push(``, `## 2. Agreement with today's Haiku filter`, ``,
    `Passed = in raw_articles; rejected = latest ${REJECTED_SAMPLE} rejected_articles.`, ``,
    `| | n | Jev accept ≥ 0.5 | AUC (passed vs rejected) |`, `|---|---|---|---|`);
  const funnelAuc = auc(scored.map((it) => get(it)!.accept), scored.map((it) => it.haikuPassed));
  const passed = scored.filter((it) => it.haikuPassed), rejected = scored.filter((it) => !it.haikuPassed);
  L.push(`| Haiku passed | ${passed.length} | ${pct(passed.filter((it) => get(it)!.accept >= 0.5).length, passed.length)} | ${f2(funnelAuc)} |`);
  L.push(`| Haiku rejected | ${rejected.length} | ${pct(rejected.filter((it) => get(it)!.accept >= 0.5).length, rejected.length)} | |`);

  const byCat = new Map<string, Item[]>();
  for (const it of rejected) byCat.set(it.category ?? "(none)", [...(byCat.get(it.category ?? "(none)") ?? []), it]);
  L.push(``, `### Rejected articles by Haiku's rejection category`, ``,
    `| category | n | mean Jev accept | mean of matching Jev rule questions |`, `|---|---|---|---|`);
  const ruleQs = ["sports", "local_only", "celebrity", "corporate_pr", "politics", "hedged"] as const;
  for (const [cat, set] of [...byCat].sort((a, b) => b[1].length - a[1].length)) {
    const mean = (q: keyof Answers) => set.reduce((n, it) => n + get(it)![q], 0) / set.length;
    L.push(`| ${cat} | ${set.length} | ${f2(mean("accept"))} | ${ruleQs.map((q) => `${q} ${mean(q).toFixed(2)}`).join(", ")} |`);
  }

  // 3. Determinism
  const reps = items.filter((it) => repeatKeys.has(it.key) && get(it, 0) && get(it, 1) && get(it, 2));
  const maxDiff = reps.reduce((m, it) => Math.max(m, ...Object.keys(QUESTIONS).map((q) => {
    const v = [0, 1, 2].map((r) => get(it, r)![q as keyof Answers]);
    return Math.max(...v) - Math.min(...v);
  })), 0);
  L.push(``, `## 3. Determinism`, ``,
    `${reps.length} articles asked 3×: largest spread on any question = ${maxDiff.toFixed(4)}.`,
    `(For comparison, two identical Haiku batch runs agreed on only 55% of accepts in Sep 2026.)`);

  // 4. Biggest disagreements to eyeball
  const show = (title: string, set: Item[]) => {
    L.push(``, `### ${title}`, ``);
    for (const it of set.slice(0, 15)) L.push(`- **${get(it)!.accept.toFixed(2)}** ${it.title.replace(/\|/g, "/")}`);
  };
  L.push(``, `## 4. Biggest disagreements with Rik (tuning weeks, repeats excluded)`);
  const tq = taste.filter((it) => !isHoldout(it) && !it.repeat);
  show("Rik approved, Jev scored lowest", tq.filter((it) => it.rikApproved).sort((a, b) => get(a)!.accept - get(b)!.accept));
  show("Rik discarded, Jev scored highest", tq.filter((it) => !it.rikApproved).sort((a, b) => get(b)!.accept - get(a)!.accept));

  writeFileSync(`${OUT}/report.md`, L.join("\n") + "\n");

  const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["key", "fetched_at", "holdout", "haiku_passed", "haiku_score", "rik_approved", "repeat", "category", "title", ...Object.keys(QUESTIONS)];
  writeFileSync(`${OUT}/results.csv`, [header.join(","), ...scored.map((it) => [
    it.key, it.fetchedAt, isHoldout(it), it.haikuPassed, it.haikuScore, it.rikApproved, it.repeat, it.category, it.title,
    ...Object.keys(QUESTIONS).map((q) => get(it)![q as keyof Answers]),
  ].map(csvCell).join(","))].join("\n") + "\n");

  console.log(`\nWrote ${OUT}/report.md and ${OUT}/results.csv`);
}

main().catch((e) => { console.error(e); process.exit(1); });
