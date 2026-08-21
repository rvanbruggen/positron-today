/**
 * Necessary Negativity — weekly generator.
 *
 * Pulls the consequential stories out of the reject pile for three themes
 * (climate, tech/AI, division), one completed week at a time, and commits the
 * result to `site/src/_data/neverskip.json` for the static site to render.
 *
 * Two things about this module are deliberate and load-bearing:
 *
 * 1. **A week is generated once and never regenerated.** The ranking model is
 *    non-deterministic — running the identical method twice reproduced only
 *    ~85% of picks. Recomputing a published week would silently rewrite the
 *    page's history, so `generateWeek` refuses a week that already has an
 *    entry unless explicitly forced.
 *
 * 2. **Ranking and rendering are separate LLM calls.** Stage 1 judges
 *    significance from the headline alone (the method validated over an
 *    11-week backfill). Stage 2 turns the winners into display prose in all
 *    three languages. Keeping them apart means translation requirements can
 *    never perturb the selection.
 */

import db from "./db";
import { commitToGitHub } from "./publish-core";
import { getNeverSkipProvider } from "./llm";
import {
  NEVER_SKIP_RANK_INSTRUCTIONS,
  buildNeverSkipRankPrompt,
  buildNeverSkipRenderPrompt,
} from "./prompts";
import { NEVER_SKIP_THEMES, NEVER_SKIP_CATEGORIES, type NeverSkipTheme } from "./never-skip-themes";
import { normaliseTitleTokens, jaccardSimilarity, SIMILARITY_THRESHOLD, MIN_SHARED_TOKENS } from "./title-similarity";
import { SCHEDULE_TZ } from "./schedule-time";

const DATA_PATH = "site/src/_data/neverskip.json";

/** Weeks kept in the published file. ~2 years; the page is a running record. */
const MAX_WEEKS = 104;

/** Hard ceiling on candidates sent to the ranker in one call. */
const MAX_CANDIDATES = 400;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface NeverSkipStory {
  /** Positron's own one-line description — this is what the page displays. */
  line_en: string;
  line_nl: string;
  line_fr: string;
  /** Why the ranker selected it. Stored for transparency; rendering optional. */
  why: string;
  url: string;
  source: string;
  /** Other outlets that ran the same story, if any. */
  also_in: string[];
  date: string;
}

export interface NeverSkipThemeBlock {
  theme: string;
  summary_en: string;
  summary_nl: string;
  summary_fr: string;
  stories: NeverSkipStory[];
  /** Distinct stories considered before ranking — context for the page. */
  considered: number;
}

export interface NeverSkipWeek {
  /** ISO-ish week key, e.g. "2026-W34". Stable identity — never reuse. */
  week: string;
  start: string;   // YYYY-MM-DD (Monday)
  end: string;     // YYYY-MM-DD (Sunday)
  generated_at: string;
  themes: NeverSkipThemeBlock[];
}

export interface NeverSkipData {
  updated_at: string;
  weeks: NeverSkipWeek[];
}

// ─── Week maths (all in SCHEDULE_TZ) ────────────────────────────────────────

function tzParts(d: Date): { y: number; m: number; day: number } {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHEDULE_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const [y, m, day] = f.format(d).split("-").map(Number);
  return { y, m, day };
}

function ymd(d: Date): string {
  const p = tzParts(d);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Midnight UTC of the given local Y-M-D — used only for day arithmetic. */
function utcOf(d: Date): Date {
  const p = tzParts(d);
  return new Date(Date.UTC(p.y, p.m - 1, p.day));
}

/** ISO-8601 week key ("2026-W34") plus the Monday and Sunday bounding it. */
export function isoWeekOf(date: Date): { week: string; start: string; end: string } {
  const d = utcOf(date);
  // ISO weekday: Monday = 1 … Sunday = 7
  const isoDow = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - (isoDow - 1));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  // Week number: the Thursday of this week determines the ISO year.
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  const jan1 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const weekNo = Math.floor((thursday.getTime() - jan1.getTime()) / 86_400_000 / 7) + 1;

  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return {
    week: `${thursday.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`,
    start: iso(monday),
    end: iso(sunday),
  };
}

/** The most recently *completed* week — i.e. the one before the current one. */
export function lastCompletedWeek(now: Date = new Date()): { week: string; start: string; end: string } {
  const d = utcOf(now);
  d.setUTCDate(d.getUTCDate() - 7);
  return isoWeekOf(d);
}

// ─── Candidate selection ────────────────────────────────────────────────────

interface Candidate {
  title: string;
  url: string;
  source: string;
  date: string;
  sources: string[];
}

/**
 * Distinct stories for one theme in one week.
 *
 * Rows are bucketed by `source_pub_date` where the feed supplied one and
 * `fetched_at` otherwise, so a story is filed under the week it was published
 * rather than the week Positron happened to scan it.
 */
async function fetchCandidates(theme: NeverSkipTheme, start: string, end: string): Promise<Candidate[]> {
  const placeholders = theme.categories.map(() => "?").join(",");
  const result = await db.execute({
    sql: `SELECT title, url, source_name, COALESCE(NULLIF(source_pub_date,''), date(fetched_at)) AS day
          FROM rejected_articles
          WHERE rejection_category IN (${placeholders})
            AND COALESCE(NULLIF(source_pub_date,''), date(fetched_at)) BETWEEN ? AND ?
            AND title IS NOT NULL AND title != ''
          ORDER BY day ASC, id ASC`,
    args: [...theme.categories, start, end],
  });

  // Collapse near-identical headlines (same story from several outlets), using
  // the same similarity rule the Preview page uses for duplicate detection.
  const clusters: { rep: Candidate; tokens: Set<string>; sources: Set<string> }[] = [];
  for (const row of result.rows) {
    const title = String(row.title);
    const source = String(row.source_name ?? "");
    const tokens = normaliseTitleTokens(title);

    let hit: (typeof clusters)[number] | undefined;
    for (const c of clusters) {
      const sim = jaccardSimilarity(tokens, c.tokens);
      if (sim < SIMILARITY_THRESHOLD) continue;
      let shared = 0;
      for (const t of tokens) if (c.tokens.has(t)) shared++;
      if (shared >= MIN_SHARED_TOKENS) { hit = c; break; }
    }

    if (hit) {
      hit.sources.add(source);
    } else {
      clusters.push({
        rep: { title, url: String(row.url), source, date: String(row.day), sources: [source] },
        tokens,
        sources: new Set([source]),
      });
    }
  }

  return clusters
    .map((c) => ({ ...c.rep, sources: [...c.sources].filter(Boolean) }))
    // Most-corroborated first. This is presentation order for the prompt only —
    // corroboration was tested as a significance signal and rejected (it ranks
    // wire syndication, not importance), so the model does the actual judging.
    .sort((a, b) => b.sources.length - a.sources.length)
    .slice(0, MAX_CANDIDATES);
}

// ─── LLM plumbing ───────────────────────────────────────────────────────────

function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  return JSON.parse(match ? match[0] : cleaned);
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const ATTEMPTS = 3;

/**
 * Ask the provider for JSON and validate it, retrying on malformed or
 * incomplete output.
 *
 * Both stages need this. Smaller models — gpt-4o-mini is the configured
 * default — return truncated or unquoted JSON often enough that a single
 * attempt loses whole themes, and a lost theme is invisible on the published
 * page rather than loud.
 *
 * `validate` returns null to reject a structurally valid but unusable
 * response, or a description of what was wrong for the log.
 */
async function generateJson<T>(
  label: string,
  prompt: string,
  maxTokens: number,
  validate: (parsed: unknown) => { value: T } | { problem: string },
): Promise<T> {
  const provider = await getNeverSkipProvider();
  let lastProblem = "";

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const raw = await provider.generate(prompt, undefined, maxTokens);
      const checked = validate(extractJson(raw));
      if ("value" in checked) return checked.value;
      lastProblem = checked.problem;
    } catch (err) {
      lastProblem = err instanceof Error ? err.message : String(err);
    }
    console.warn(`[never-skip] ${label} attempt ${attempt}/${ATTEMPTS}: ${lastProblem}`);
  }

  throw new Error(`${label} failed after ${ATTEMPTS} attempts (${lastProblem})`);
}

interface RankPick { index: number; why: string }

async function rankTheme(
  theme: NeverSkipTheme,
  weekLabel: string,
  candidates: Candidate[],
  maxPicks: number,
): Promise<{ picks: RankPick[]; discarded_note: string }> {
  const prompt = buildNeverSkipRankPrompt(
    NEVER_SKIP_RANK_INSTRUCTIONS,
    theme.label_en,
    weekLabel,
    candidates.map((c) => ({ title: c.title, sources: c.sources })),
    maxPicks,
  );

  return generateJson<{ picks: RankPick[]; discarded_note: string }>(`${theme.key} rank`, prompt, 2000, (parsed) => {
    const p = parsed as { picks?: unknown; discarded_note?: unknown };
    if (!Array.isArray(p.picks)) return { problem: "no picks array" };

    const seen = new Set<number>();
    const picks: RankPick[] = (p.picks as Record<string, unknown>[])
      .map((x) => ({ index: Number(x.index), why: str(x.why) }))
      // The model occasionally invents an index outside the list.
      .filter((x) => Number.isInteger(x.index) && x.index >= 1 && x.index <= candidates.length)
      .filter((x) => (seen.has(x.index) ? false : (seen.add(x.index), true)))
      .slice(0, maxPicks);

    // An empty array is a legitimate verdict ("nothing here was consequential"),
    // so it is only a retry-worthy problem if the model returned picks and every
    // one of them was unusable.
    if (picks.length === 0 && (p.picks as unknown[]).length > 0) {
      return { problem: `all ${(p.picks as unknown[]).length} picks had invalid indices` };
    }

    return { value: { picks, discarded_note: str(p.discarded_note) } };
  });
}

interface RenderResult {
  summary_en: string; summary_nl: string; summary_fr: string;
  lines: { line_en: string; line_nl: string; line_fr: string }[];
}

async function renderTheme(
  theme: NeverSkipTheme,
  weekLabel: string,
  picks: { title: string; sources: string[]; why: string }[],
): Promise<RenderResult> {
  const prompt = buildNeverSkipRenderPrompt(theme.label_en, weekLabel, picks);

  return generateJson<RenderResult>(`${theme.key} render`, prompt, 4000, (parsed) => {
    const p = parsed as Record<string, unknown>;
    const lines = Array.isArray(p.lines)
      ? (p.lines as Record<string, unknown>[]).map((l) => ({
          line_en: str(l.line_en), line_nl: str(l.line_nl), line_fr: str(l.line_fr),
        }))
      : [];

    // Every language must be present for every story. A half-translated block
    // would put English on the Dutch page — the exact defect this two-stage
    // design exists to prevent — so it is worth a retry rather than a shrug.
    const missing: string[] = [];
    for (const f of ["summary_en", "summary_nl", "summary_fr"] as const) {
      if (!str(p[f])) missing.push(f);
    }
    if (lines.length !== picks.length) missing.push(`lines (${lines.length}/${picks.length})`);
    lines.forEach((l, i) => {
      if (!l.line_en) missing.push(`lines[${i}].line_en`);
      if (!l.line_nl) missing.push(`lines[${i}].line_nl`);
      if (!l.line_fr) missing.push(`lines[${i}].line_fr`);
    });

    if (missing.length) return { problem: `missing ${missing.slice(0, 4).join(", ")}` };

    return {
      value: {
        summary_en: str(p.summary_en), summary_nl: str(p.summary_nl), summary_fr: str(p.summary_fr),
        lines,
      },
    };
  });
}

// ─── Published file ─────────────────────────────────────────────────────────

const RAW_URL = (repo: string, branch: string) =>
  `https://raw.githubusercontent.com/${repo}/${branch}/${DATA_PATH}`;

async function loadExisting(): Promise<NeverSkipData> {
  const repo = process.env.GITHUB_REPO ?? "";
  const branch = process.env.GITHUB_BRANCH ?? "main";
  const empty: NeverSkipData = { updated_at: new Date().toISOString(), weeks: [] };
  if (!repo) return empty;

  try {
    const res = await fetch(`${RAW_URL(repo, branch)}?t=${Date.now()}`, {
      headers: process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {},
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return empty;             // 404 on first ever run
    const data = (await res.json()) as NeverSkipData;
    return Array.isArray(data?.weeks) ? data : empty;
  } catch (err) {
    // A network blip must not be read as "no weeks exist" — that would let the
    // generator overwrite the published history with a single week.
    throw new Error(`Could not read existing ${DATA_PATH}: ${err instanceof Error ? err.message : err}`);
  }
}

// ─── Public entry points ────────────────────────────────────────────────────

export interface GenerateResult {
  ok: boolean;
  week?: string;
  skipped?: boolean;
  reason?: string;
  themes?: { theme: string; considered: number; published: number }[];
  /** Populated on a dry run — the week that would have been committed. */
  preview?: NeverSkipWeek;
  error?: string;
}

/**
 * Generate one week and commit it.
 *
 * Returns `skipped: true` when the week already exists — that is the normal,
 * expected outcome of a cron tick, not an error. Pass `force` only for a
 * deliberate manual re-run; it discards the published version of that week.
 *
 * `dryRun` does everything except the commit and returns the built week, so a
 * week can be inspected before it goes live.
 */
export async function generateWeek(
  target?: { week: string; start: string; end: string },
  opts: { force?: boolean; dryRun?: boolean } = {},
): Promise<GenerateResult> {
  const wk = target ?? lastCompletedWeek();

  try {
    const data = opts.dryRun ? { updated_at: "", weeks: [] } : await loadExisting();

    if (!opts.force && !opts.dryRun && data.weeks.some((w) => w.week === wk.week)) {
      return { ok: true, skipped: true, week: wk.week, reason: `Week ${wk.week} already generated` };
    }

    const settings = (await import("./settings")).getSettings;
    const maxPicks = Math.max(1, Math.min(10, parseInt((await settings()).neverskip_count, 10) || 5));
    const weekLabel = `${wk.start} to ${wk.end}`;

    // The three themes are independent, so they run concurrently — six
    // sequential model calls took ~100s, which is a long time to hold a
    // browser request open on a manual run. Results are re-ordered to match
    // NEVER_SKIP_THEMES afterwards so the page order never depends on which
    // theme happened to finish first.
    const settled = await Promise.all(
      NEVER_SKIP_THEMES.map(async (theme): Promise<{
        theme: NeverSkipTheme;
        considered: number;
        block: NeverSkipThemeBlock | null;
      }> => {
        const candidates = await fetchCandidates(theme, wk.start, wk.end);
        if (candidates.length === 0) {
          console.log(`[never-skip] ${wk.week}/${theme.key}: no candidates, skipping theme`);
          return { theme, considered: 0, block: null };
        }

        const { picks } = await rankTheme(theme, weekLabel, candidates, maxPicks);
        if (picks.length === 0) {
          console.log(`[never-skip] ${wk.week}/${theme.key}: ${candidates.length} candidates, none judged consequential`);
          return { theme, considered: candidates.length, block: null };
        }

        const chosen = picks.map((p) => ({ ...candidates[p.index - 1], why: p.why }));
        const rendered = await renderTheme(
          theme, weekLabel,
          chosen.map((c) => ({ title: c.title, sources: c.sources, why: c.why })),
        );

        console.log(`[never-skip] ${wk.week}/${theme.key}: ${chosen.length} of ${candidates.length}`);
        return {
          theme,
          considered: candidates.length,
          block: {
            theme: theme.key,
            summary_en: rendered.summary_en,
            summary_nl: rendered.summary_nl,
            summary_fr: rendered.summary_fr,
            considered: candidates.length,
            stories: chosen.map((c, i) => ({
              line_en: rendered.lines[i].line_en,
              line_nl: rendered.lines[i].line_nl,
              line_fr: rendered.lines[i].line_fr,
              why: c.why,
              url: c.url,
              source: c.source,
              also_in: c.sources.filter((s) => s !== c.source),
              date: c.date,
            })),
          },
        };
      }),
    );

    const themes: NeverSkipThemeBlock[] = settled
      .map((r) => r.block)
      .filter((b): b is NeverSkipThemeBlock => b !== null);
    const report = settled.map((r) => ({
      theme: r.theme.key,
      considered: r.considered,
      published: r.block?.stories.length ?? 0,
    }));

    if (themes.length === 0) {
      return { ok: true, skipped: true, week: wk.week, reason: "No publishable stories in any theme", themes: report };
    }

    const week: NeverSkipWeek = {
      week: wk.week, start: wk.start, end: wk.end,
      generated_at: new Date().toISOString(),
      themes,
    };

    if (opts.dryRun) {
      return { ok: true, week: wk.week, themes: report, preview: week };
    }

    const weeks = [week, ...data.weeks.filter((w) => w.week !== wk.week)]
      .sort((a, b) => b.week.localeCompare(a.week))
      .slice(0, MAX_WEEKS);

    await commitToGitHub(
      DATA_PATH,
      JSON.stringify({ updated_at: new Date().toISOString(), weeks }, null, 2),
      `Necessary Negativity: ${wk.week}`,
    );

    return { ok: true, week: wk.week, themes: report };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[never-skip] ${wk.week} failed: ${error}`);
    return { ok: false, week: wk.week, error };
  }
}

/**
 * Is a given week already published?
 *
 * Lets the admin answer "did my manual run land?" without re-running the
 * generator — a manual run takes long enough that the browser request is
 * often abandoned before it returns.
 */
export async function isWeekPublished(week: string): Promise<boolean | null> {
  try {
    const data = await loadExisting();
    return data.weeks.some((w) => w.week === week);
  } catch {
    // Could not read the published file — report "unknown" rather than
    // claiming the week is missing, which would invite a needless re-run.
    return null;
  }
}

/**
 * Catch-up check. Called on boot and on every weekly cron tick.
 *
 * The cron time is a trigger, not the guard — the real question is always
 * "does the last completed week have an entry?". That makes the job idempotent
 * and self-healing across container restarts, crashes and downtime.
 */
export async function runNeverSkipIfDue(): Promise<GenerateResult> {
  const wk = lastCompletedWeek();
  return generateWeek(wk);
}

/** Backfill older weeks, oldest first. Existing weeks are left untouched. */
export async function backfillWeeks(count: number): Promise<GenerateResult[]> {
  const out: GenerateResult[] = [];
  for (let i = count; i >= 1; i--) {
    const d = utcOf(new Date());
    d.setUTCDate(d.getUTCDate() - 7 * i);
    const res = await generateWeek(isoWeekOf(d));
    out.push(res);
    if (!res.ok) break;   // stop on first hard failure rather than burning the rest
  }
  return out;
}

export { NEVER_SKIP_CATEGORIES, ymd };
