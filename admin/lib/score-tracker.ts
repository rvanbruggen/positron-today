/**
 * Positivity Score Tracker.
 *
 * Derives positivity scores from existing pipeline data (raw_articles
 * and rejected_articles) — no external API calls needed. Runs
 * automatically after each pipeline run and commits results to GitHub
 * so the static site can render a trend chart.
 *
 * Scoring: positivity_score 7-10 = positive, 4-6 = neutral, 1-3 = negative.
 * For legacy data where rejected articles have no score: accepted = positive,
 * rejected = negative.
 */

import { commitToGitHub } from "@/lib/publish-core";
import db from "@/lib/db";

const GITHUB_REPO = process.env.GITHUB_REPO ?? "";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? "";

const DATA_PATH = "site/src/_data/scores.json";
const MAX_DAYS = 90;

interface ScoreEntry {
  date: string;
  source: string;
  url: string;
  score: number;
  total: number;
  breakdown: { positive: number; negative: number; neutral: number };
}

interface ScoresData {
  updated_at: string;
  entries: ScoreEntry[];
}

function classify(score: number | null, hasScore: boolean, isAccepted: boolean): "positive" | "negative" | "neutral" {
  if (hasScore && score != null) {
    if (score >= 7) return "positive";
    if (score >= 4) return "neutral";
    return "negative";
  }
  return isAccepted ? "positive" : "negative";
}

async function scoreSourceForDate(source: { id: number; name: string; url: string }, date: string): Promise<ScoreEntry | null> {
  const accepted = await db.execute({
    sql: `SELECT positivity_score FROM raw_articles
          WHERE source_id = ? AND source_pub_date = ?`,
    args: [source.id, date],
  });

  const rejected = await db.execute({
    sql: `SELECT positivity_score FROM rejected_articles
          WHERE source_id = ? AND source_pub_date = ?`,
    args: [source.id, date],
  });

  const total = accepted.rows.length + rejected.rows.length;
  if (total === 0) return null;

  let positive = 0;
  let negative = 0;
  let neutral = 0;

  for (const row of accepted.rows) {
    const score = row.positivity_score != null ? Number(row.positivity_score) : null;
    const cat = classify(score, score != null, true);
    if (cat === "positive") positive++;
    else if (cat === "neutral") neutral++;
    else negative++;
  }

  for (const row of rejected.rows) {
    const score = row.positivity_score != null ? Number(row.positivity_score) : null;
    const cat = classify(score, score != null, false);
    if (cat === "positive") positive++;
    else if (cat === "neutral") neutral++;
    else negative++;
  }

  const pct = Math.round((positive / total) * 100);

  return {
    date,
    source: source.name,
    url: source.url,
    score: pct,
    total,
    breakdown: { positive, negative, neutral },
  };
}

async function getAvailableDates(): Promise<string[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const result = await db.execute({
    sql: `
      SELECT DISTINCT source_pub_date as d FROM raw_articles
        WHERE source_pub_date IS NOT NULL AND source_pub_date >= ?
      UNION
      SELECT DISTINCT source_pub_date as d FROM rejected_articles
        WHERE source_pub_date IS NOT NULL AND source_pub_date >= ?
      ORDER BY d ASC
    `,
    args: [cutoffStr, cutoffStr],
  });
  return result.rows.map((r) => String(r.d)).filter(Boolean);
}

async function fetchExistingScores(): Promise<ScoresData> {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${DATA_PATH}`;
  const headers = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
  };

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return { updated_at: "", entries: [] };

    const json = await res.json();
    const content = Buffer.from(json.content, "base64").toString("utf-8");
    return JSON.parse(content) as ScoresData;
  } catch (err) {
    console.warn("[score-tracker] Could not fetch existing scores:", err instanceof Error ? err.message : err);
    return { updated_at: "", entries: [] };
  }
}

function pruneOldEntries(entries: ScoreEntry[]): ScoreEntry[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return entries.filter((e) => e.date >= cutoffStr);
}

export async function runScoreTracker(): Promise<{
  ok: boolean;
  scored: number;
  failed: number;
}> {
  console.log("[score-tracker] Starting score collection from pipeline data…");

  const result = await db.execute("SELECT id, name, url FROM sources WHERE active = 1 ORDER BY name");
  const allSources = result.rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    url: String(r.url),
  }));

  const existing = await fetchExistingScores();
  const now = new Date().toISOString();

  // Build a set of existing date+source keys to avoid duplicates
  const existingKeys = new Set(
    existing.entries.map((e) => `${e.date}|${e.source}`),
  );

  // Score all available dates, not just today
  const dates = await getAvailableDates();
  console.log(`[score-tracker] ${allSources.length} sources, ${dates.length} dates in DB, ${existingKeys.size} existing entries`);
  if (dates.length > 0) {
    console.log(`[score-tracker] Date range: ${dates[0]} → ${dates[dates.length - 1]}`);
  }

  const results: ScoreEntry[] = [];
  let skipped = 0;
  let deduped = 0;

  for (const date of dates) {
    for (const source of allSources) {
      if (existingKeys.has(`${date}|${source.name}`)) { deduped++; continue; }
      const entry = await scoreSourceForDate(source, date);
      if (entry) {
        results.push(entry);
      } else {
        skipped++;
      }
    }
  }

  console.log(`[score-tracker] ${results.length} new scores, ${deduped} already existed, ${skipped} had no articles`);

  if (results.length === 0) {
    console.log("[score-tracker] No new scores to add, skipping commit");
    return { ok: false, scored: 0, failed: skipped };
  }

  const allEntries = pruneOldEntries([...existing.entries, ...results]);

  const data: ScoresData = {
    updated_at: now,
    entries: allEntries,
  };

  const content = JSON.stringify(data, null, 2);
  console.log(`[score-tracker] Committing ${allEntries.length} entries (${Math.round(content.length / 1024)} KB)…`);

  try {
    await commitToGitHub(DATA_PATH, content, `Update positivity scores (${now.slice(0, 10)})`);
    console.log(`[score-tracker] Committed ${results.length} new scores across ${dates.length} dates`);
  } catch (err) {
    const cause = err instanceof Error && "cause" in err ? ` cause=${(err as { cause?: unknown }).cause}` : "";
    console.error(`[score-tracker] Commit failed: ${err instanceof Error ? err.message : err}${cause}`);
    throw err;
  }
  return { ok: true, scored: results.length, failed: skipped };
}
