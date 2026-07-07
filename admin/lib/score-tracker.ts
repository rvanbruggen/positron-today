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

async function scoreSourceFromDb(source: { id: number; name: string; url: string }): Promise<ScoreEntry | null> {
  const today = new Date().toISOString().slice(0, 10);

  const accepted = await db.execute({
    sql: `SELECT positivity_score FROM raw_articles
          WHERE source_id = ? AND date(fetched_at) = ?`,
    args: [source.id, today],
  });

  const rejected = await db.execute({
    sql: `SELECT positivity_score FROM rejected_articles
          WHERE source_id = ? AND date(fetched_at) = ?`,
    args: [source.id, today],
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
    date: today,
    source: source.name,
    url: source.url,
    score: pct,
    total,
    breakdown: { positive, negative, neutral },
  };
}

async function fetchExistingScores(): Promise<ScoresData> {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${DATA_PATH}`;
  const headers = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
  };

  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return { updated_at: "", entries: [] };

    const json = await res.json();
    const content = Buffer.from(json.content, "base64").toString("utf-8");
    return JSON.parse(content) as ScoresData;
  } catch {
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
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  const results: ScoreEntry[] = [];
  let skipped = 0;

  for (const source of allSources) {
    const entry = await scoreSourceFromDb(source);
    if (entry) {
      results.push(entry);
    } else {
      skipped++;
    }
  }

  if (results.length === 0) {
    console.log("[score-tracker] No scores collected, skipping commit");
    return { ok: false, scored: 0, failed: skipped };
  }

  const allEntries = pruneOldEntries([...existing.entries, ...results]);

  const data: ScoresData = {
    updated_at: now,
    entries: allEntries,
  };

  const content = JSON.stringify(data, null, 2);
  await commitToGitHub(DATA_PATH, content, `Update positivity scores (${today})`);

  console.log(`[score-tracker] Committed ${results.length} scores (${skipped} sources had no articles today)`);
  return { ok: true, scored: results.length, failed: skipped };
}
