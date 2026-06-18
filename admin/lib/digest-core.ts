/**
 * Digest posting core logic — extracted from the API route so the
 * built-in scheduler can trigger digest posts without an HTTP call.
 */

import db from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { scheduleNow } from "@/lib/schedule-time";
import {
  generateDigestCollage,
  MIN_DIGEST_ARTICLES,
  MAX_DIGEST_ARTICLES,
  type DigestArticle,
} from "@/lib/digest-collage";
import { buildDigestCaption, buildInstagramDigestCaption, type DigestCaptionArticle } from "@/lib/digest-caption";
import {
  getEnabledAccounts,
  uploadCardToPostForMe,
  postToPlatforms,
  getApiKey,
} from "@/lib/social-helpers";

const LAST_RUNS_KEY = "digest_last_runs";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ArticleRow {
  id: number;
  title_en: string | null;
  title_nl: string | null;
  article_emoji: string | null;
  image_url: string | null;
}

export interface DigestResult {
  ok: boolean;
  message?: string;
  error?: string;
  articles?: Array<{ id: number; title: string | null }>;
  errors?: string[];
}

// ─── Slot gating ────────────────────────────────────────────────────────────

export async function findDueDigestSlot(runTimesJson: string): Promise<{ due: boolean; slot: string; reason: string }> {
  let times: string[];
  try { times = JSON.parse(runTimesJson); } catch { times = []; }
  if (times.length === 0) return { due: false, slot: "", reason: "No digest times configured." };

  const { date, totalMins } = scheduleNow();

  const completedResult = await db.execute({
    sql: "SELECT value FROM settings WHERE key = ?",
    args: [LAST_RUNS_KEY],
  });
  let lastRuns: Record<string, string[]> = {};
  try {
    lastRuns = JSON.parse(String(completedResult.rows[0]?.value ?? "{}"));
  } catch { /* empty */ }
  const todaysRuns: string[] = lastRuns[date] ?? [];

  for (const slot of times) {
    const [h, m] = slot.split(":").map(Number);
    const slotMins = h * 60 + m;
    if (totalMins >= slotMins && !todaysRuns.includes(slot)) {
      return { due: true, slot, reason: `Digest slot ${slot} is due (${Math.floor(totalMins / 60)}:${String(totalMins % 60).padStart(2, "0")})` };
    }
  }

  return { due: false, slot: "", reason: `No digest slots due. Today's completed: [${todaysRuns.join(", ")}]` };
}

export async function markDigestSlotCompleted(slot: string): Promise<void> {
  const { date } = scheduleNow();
  const result = await db.execute({
    sql: "SELECT value FROM settings WHERE key = ?",
    args: [LAST_RUNS_KEY],
  });
  let lastRuns: Record<string, string[]> = {};
  try {
    lastRuns = JSON.parse(String(result.rows[0]?.value ?? "{}"));
  } catch { /* empty */ }

  const todaysRuns = lastRuns[date] ?? [];
  todaysRuns.push(slot);
  const cleaned: Record<string, string[]> = { [date]: todaysRuns };

  await db.execute({
    sql: `INSERT INTO settings (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [LAST_RUNS_KEY, JSON.stringify(cleaned)],
  });
}

// ─── Article fetching ───────────────────────────────────────────────────────

export async function fetchDigestArticles(): Promise<{ articles: ArticleRow[]; tags: Map<number, string[]> }> {
  const result = await db.execute({
    sql: `SELECT id, title_en, title_nl, article_emoji, image_url
          FROM articles
          WHERE digest_pick = 1
            AND digest_posted_at IS NULL
            AND status = 'published'
          ORDER BY published_at DESC
          LIMIT ?`,
    args: [MAX_DIGEST_ARTICLES],
  });

  const articles: ArticleRow[] = result.rows.map((r) => ({
    id: Number(r.id),
    title_en: r.title_en ? String(r.title_en) : null,
    title_nl: r.title_nl ? String(r.title_nl) : null,
    article_emoji: r.article_emoji ? String(r.article_emoji) : null,
    image_url: r.image_url ? String(r.image_url) : null,
  }));

  if (articles.length === 0) return { articles, tags: new Map() };

  const ids = articles.map((a) => a.id);
  const placeholders = ids.map(() => "?").join(",");
  const tagResult = await db.execute({
    sql: `SELECT at2.article_id, t.name
          FROM article_tags at2
          JOIN topics t ON at2.tag_id = t.id
          WHERE at2.article_id IN (${placeholders})`,
    args: ids,
  });

  const tags = new Map<number, string[]>();
  for (const r of tagResult.rows) {
    const aid = Number(r.article_id);
    const name = String(r.name);
    if (!tags.has(aid)) tags.set(aid, []);
    tags.get(aid)!.push(name);
  }

  return { articles, tags };
}

// ─── Main digest logic ─────────────────────────────────────────────────────

export async function runDigest(options?: { isManual?: boolean }): Promise<DigestResult> {
  const isManual = options?.isManual ?? false;

  let dueSlot = "";
  if (!isManual) {
    const settings = await getSettings();
    const schedule = await findDueDigestSlot(settings.digest_run_times ?? "[]");
    console.log(`[digest] ${schedule.reason}`);
    if (!schedule.due) {
      return { ok: false, message: schedule.reason };
    }
    dueSlot = schedule.slot;
  }

  if (!getApiKey()) {
    return { ok: false, error: "POSTFORME_API_KEY is not set." };
  }

  const { articles, tags } = await fetchDigestArticles();

  if (articles.length < MIN_DIGEST_ARTICLES) {
    return {
      ok: false,
      error: `Need at least ${MIN_DIGEST_ARTICLES} articles with digest_pick=1, found ${articles.length}. Pick more articles for the digest on the History page.`,
    };
  }

  const digestArticles: DigestArticle[] = articles.map((a) => ({
    title: a.title_en ?? a.title_nl ?? "",
    emoji: a.article_emoji ?? "✨",
    imageUrl: a.image_url,
  }));

  const captionArticles: DigestCaptionArticle[] = articles.map((a) => ({
    emoji: a.article_emoji ?? "✨",
    title: a.title_en ?? a.title_nl ?? "",
    tags: tags.get(a.id) ?? [],
  }));

  const caption = await buildDigestCaption(captionArticles);
  const instagramCaption = buildInstagramDigestCaption(captionArticles);

  let collagePng: Buffer;
  try {
    console.log("[digest] Generating collage…");
    collagePng = await generateDigestCollage(digestArticles);
    console.log(`[digest] Collage generated: ${(collagePng.byteLength / 1024).toFixed(0)} KB`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[digest] Collage generation failed:", msg);
    return { ok: false, error: `Collage generation failed: ${msg}` };
  }

  const enabledAccounts = await getEnabledAccounts();
  if (enabledAccounts.length === 0) {
    return { ok: false, error: "No social accounts enabled." };
  }

  const instagramAccounts = enabledAccounts.filter((a) => a.platform === "instagram");
  const textAccounts = enabledAccounts.filter((a) => a.platform !== "instagram");

  const results: Record<string, unknown> = {};
  const errors: string[] = [];

  let collageMediaUrl: string | null = null;
  try {
    console.log("[digest] Uploading collage to Post for Me…");
    collageMediaUrl = await uploadCardToPostForMe(collagePng);
    console.log(`[digest] Collage uploaded: ${collageMediaUrl}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[digest] Collage upload failed:", msg);
    errors.push(`Collage upload: ${msg}`);
  }

  if (textAccounts.length > 0) {
    try {
      results.text = await postToPlatforms(textAccounts.map((a) => a.id), caption, collageMediaUrl ?? undefined);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[digest] Text post failed:", msg);
      errors.push(`Text platforms: ${msg}`);
    }
  }

  if (instagramAccounts.length > 0) {
    try {
      results.instagram = await postToPlatforms(
        instagramAccounts.map((a) => a.id),
        instagramCaption,
        collageMediaUrl ?? undefined,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[digest] Instagram post failed:", msg);
      errors.push(`Instagram: ${msg}`);
    }
  }

  const expectedPlatforms = (textAccounts.length > 0 ? 1 : 0) + (instagramAccounts.length > 0 ? 1 : 0);
  const succeededPlatforms = Object.keys(results).length;
  const allSucceeded = succeededPlatforms === expectedPlatforms && errors.length === 0;
  const anySuccess = succeededPlatforms > 0;

  if (allSucceeded) {
    // All platforms succeeded — mark articles as posted and slot as done
    const ids = articles.map((a) => a.id);
    const placeholders = ids.map(() => "?").join(",");
    await db.execute({
      sql: `UPDATE articles SET digest_posted_at = datetime('now') WHERE id IN (${placeholders})`,
      args: ids,
    });
    if (dueSlot) {
      await markDigestSlotCompleted(dueSlot);
    }
  } else if (anySuccess) {
    // Partial success — log but don't mark slot complete so it retries
    console.warn(`[digest] Partial success: ${succeededPlatforms}/${expectedPlatforms} platforms. Slot NOT marked complete — will retry on next trigger.`);
  }

  const articleSummary = articles.map((a) => ({ id: a.id, title: a.title_en ?? a.title_nl }));
  return {
    ok: allSucceeded,
    articles: articleSummary,
    errors: errors.length > 0 ? errors : undefined,
    ...(allSucceeded ? {} : anySuccess ? { error: `Partial success: ${errors.join("; ")}` } : { error: "All platforms failed" }),
  };
}
