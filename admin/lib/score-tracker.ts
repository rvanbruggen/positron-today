/**
 * Positivity Score Tracker.
 *
 * Calls the scoring API for a curated list of news sources,
 * appends results to a historical JSON file, and commits it
 * to GitHub so the static site can render a chart.
 */

import { commitToGitHub } from "@/lib/publish-core";
import { getSettings } from "@/lib/settings";

const SCORE_API = process.env.SCORE_API_URL ?? "https://api.positron.today/api/score";
const GITHUB_REPO = process.env.GITHUB_REPO ?? "";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? "";

const DATA_PATH = "site/src/_data/scores.json";

const DEFAULT_TRACKED_SOURCES: { name: string; url: string }[] = [
  { name: "BBC", url: "https://www.bbc.com" },
  { name: "CNN", url: "https://www.cnn.com" },
  { name: "The Guardian", url: "https://www.theguardian.com" },
  { name: "Reuters", url: "https://www.reuters.com" },
  { name: "NY Times", url: "https://www.nytimes.com" },
  { name: "Le Monde", url: "https://www.lemonde.fr" },
  { name: "De Standaard", url: "https://www.standaard.be" },
  { name: "VRT NWS", url: "https://www.vrt.be/vrtnws/nl/" },
  { name: "De Morgen", url: "https://www.demorgen.be" },
  { name: "Le Soir", url: "https://www.lesoir.be" },
  { name: "Positron Today", url: "https://positron.today" },
];

async function getTrackedSources(): Promise<{ name: string; url: string }[]> {
  try {
    const settings = await getSettings();
    const parsed = JSON.parse(settings.score_tracked_sources);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}
  return DEFAULT_TRACKED_SOURCES;
}

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

async function scoreSource(
  source: { name: string; url: string }
): Promise<ScoreEntry | null> {
  try {
    const res = await fetch(
      `${SCORE_API}?url=${encodeURIComponent(source.url)}`,
      { signal: AbortSignal.timeout(30_000) }
    );
    if (!res.ok) return null;

    const data = await res.json();
    if (data.error) return null;

    return {
      date: new Date().toISOString().slice(0, 10),
      source: source.name,
      url: source.url,
      score: data.score,
      total: data.total,
      breakdown: data.breakdown,
    };
  } catch {
    return null;
  }
}

export async function runScoreTracker(): Promise<{
  ok: boolean;
  scored: number;
  failed: number;
}> {
  console.log("[score-tracker] Starting score collection…");

  const trackedSources = await getTrackedSources();
  const existing = await fetchExistingScores();
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  const results: ScoreEntry[] = [];
  let failed = 0;

  for (const source of trackedSources) {
    console.log(`[score-tracker] Scoring ${source.name}…`);
    const entry = await scoreSource(source);
    if (entry) {
      results.push(entry);
    } else {
      console.warn(`[score-tracker] Failed to score ${source.name}`);
      failed++;
    }
  }

  if (results.length === 0) {
    console.log("[score-tracker] No scores collected, skipping commit");
    return { ok: false, scored: 0, failed };
  }

  const allEntries = pruneOldEntries([...existing.entries, ...results]);

  const data: ScoresData = {
    updated_at: now,
    entries: allEntries,
  };

  const content = JSON.stringify(data, null, 2);
  await commitToGitHub(DATA_PATH, content, `Update positivity scores (${today})`);

  console.log(`[score-tracker] Committed ${results.length} scores (${failed} failed)`);
  return { ok: true, scored: results.length, failed };
}
