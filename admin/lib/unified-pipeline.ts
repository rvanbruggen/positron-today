/**
 * Unified Pipeline — the single pipeline implementation.
 *
 * Phases (controlled by positronitron_mode):
 *   1. Fetch ALL RSS sources
 *   2. Classify ALL pending items
 *   3. Run positronitron (pick + summarise + schedule)  — "summarise" or "full" mode
 *   4. Publish scheduled articles to GitHub              — "full" mode
 *   5. Post to social media                              — "full" mode
 *
 * Progress is written to the `pipeline_runs` table so the admin UI
 * can monitor it via /api/pipeline/status (read-only polling).
 */

import db from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { exportRejections } from "@/lib/export-rejections";
import { getFilterProvider } from "@/lib/llm";
import { buildFilterInstructions, buildFilterPrompt } from "@/lib/prompts";
import { CATEGORY_SLUGS } from "@/lib/rejection-categories";
import { isNativeOutputLanguage } from "@/lib/languages";
import { runPositronitron } from "@/lib/positronitron-core";
import { publishScheduledArticles } from "@/lib/publish-core";
import { postPendingSocial } from "@/lib/social-post-core";
import RSSParser from "rss-parser";
import { withRetry } from "@/lib/retry";

const parser = new RSSParser({ timeout: 8000 });

let running = false;
let activeRunId: number | null = null;
let cancelRequested = false;

export function isUnifiedPipelineRunning(): boolean {
  return running;
}

export function getActiveRunId(): number | null {
  return activeRunId;
}

export function requestCancel(): void {
  cancelRequested = true;
}

type LogLine = object;

// ─── DB progress helpers ────────────────────────────────────────────────────

async function createRun(totalSources: number): Promise<number> {
  const result = await db.execute({
    sql: `INSERT INTO pipeline_runs (status, phase, total_sources, log)
          VALUES ('running', 'fetch', ?, '[]')`,
    args: [totalSources],
  });
  return Number(result.lastInsertRowid);
}

async function updateRun(
  runId: number,
  fields: Record<string, string | number>,
): Promise<void> {
  const sets = Object.entries(fields).map(([k]) => `${k} = ?`).join(", ");
  const vals = Object.values(fields);
  await db.execute({ sql: `UPDATE pipeline_runs SET ${sets} WHERE id = ?`, args: [...vals, runId] });
}

async function appendLog(runId: number, entry: LogLine): Promise<void> {
  const result = await db.execute({
    sql: "SELECT log FROM pipeline_runs WHERE id = ?",
    args: [runId],
  });
  const existing: LogLine[] = JSON.parse(String(result.rows[0]?.log ?? "[]"));
  existing.push(entry);
  await db.execute({
    sql: "UPDATE pipeline_runs SET log = ? WHERE id = ?",
    args: [JSON.stringify(existing), runId],
  });
}

async function finishRun(runId: number, status: "done" | "error", errorMessage?: string): Promise<void> {
  await db.execute({
    sql: `UPDATE pipeline_runs SET status = ?, error_message = ?, finished_at = datetime('now') WHERE id = ?`,
    args: [status, errorMessage ?? null, runId],
  });
}

// ─── Phase 1: Fetch ALL sources ──────────────────────────────────────────────

async function fetchAllSources(runId: number): Promise<{ queued: number; skipped: number; errors: number }> {
  const allSources = await db.execute(
    "SELECT * FROM sources WHERE active = 1 AND paused = 0 AND (feed_url IS NOT NULL OR type = 'rss') ORDER BY id ASC",
  );

  const totalSources = allSources.rows.length;
  await updateRun(runId, { total_sources: totalSources });
  await appendLog(runId, { type: "start", phase: "fetch-feeds", totalSources });

  console.log(`[unified] Phase 1: Fetching ${totalSources} sources`);

  let totalQueued = 0, totalSkipped = 0, totalErrors = 0, sourcesDone = 0;

  for (const source of allSources.rows) {
    if (cancelRequested) break;

    const feedUrl = (source.feed_url ?? source.url) as string;
    const sourceName = String(source.name);
    let queued = 0, skipped = 0;

    await appendLog(runId, { type: "source", name: sourceName, url: feedUrl });

    try {
      const feed = await withRetry(() => parser.parseURL(feedUrl), { label: `RSS ${sourceName}` });
      const items = feed.items.slice(0, 10).filter(i => i.link && i.title);

      for (const item of items) {
        const [existingPending, existingRaw, existingRejected, existingArticle] = await Promise.all([
          db.execute({ sql: "SELECT id FROM pending_items WHERE url = ?", args: [item.link!] }),
          db.execute({ sql: "SELECT id FROM raw_articles WHERE url = ?", args: [item.link!] }),
          db.execute({ sql: "SELECT id FROM rejected_articles WHERE url = ?", args: [item.link!] }),
          db.execute({ sql: "SELECT id FROM articles WHERE source_url = ?", args: [item.link!] }),
        ]);

        if (existingPending.rows.length > 0 || existingRaw.rows.length > 0 ||
            existingRejected.rows.length > 0 || existingArticle.rows.length > 0) {
          skipped++;
          continue;
        }

        const snippet = item.contentSnippet ?? item.content ?? "";
        const sourcePubDate = item.isoDate
          ? item.isoDate.slice(0, 10)
          : item.pubDate
          ? new Date(item.pubDate).toISOString().slice(0, 10)
          : null;

        try {
          await db.execute({
            sql: `INSERT INTO pending_items (source_id, url, title, snippet, source_pub_date) VALUES (?, ?, ?, ?, ?)`,
            args: [source.id, item.link!, item.title!, snippet, sourcePubDate],
          });
          queued++;
          await appendLog(runId, { type: "item", verdict: "queued", title: item.title! });
        } catch { /* duplicate */ }
      }
      await db.execute({
        sql: `UPDATE sources SET last_fetch_status = 'ok', last_fetch_error = NULL,
              last_fetch_at = datetime('now'), consecutive_failures = 0 WHERE id = ?`,
        args: [source.id],
      });
    } catch (err) {
      console.warn(`[unified] Error fetching ${sourceName}: ${err}`);
      totalErrors++;
      await appendLog(runId, { type: "source_error", name: sourceName, message: String(err) });

      const newFailures = Number(source.consecutive_failures ?? 0) + 1;
      const shouldPause = newFailures > 2 ? 1 : 0;
      await db.execute({
        sql: `UPDATE sources SET last_fetch_status = 'error', last_fetch_error = ?,
              last_fetch_at = datetime('now'), consecutive_failures = ?,
              paused = ? WHERE id = ?`,
        args: [String(err).slice(0, 500), newFailures, shouldPause, source.id],
      });
      if (shouldPause) {
        console.warn(`[unified] Auto-paused "${sourceName}" after ${newFailures} consecutive failures`);
        await appendLog(runId, { type: "source_paused", name: sourceName, failures: newFailures });
      }
    }

    totalQueued += queued;
    totalSkipped += skipped;
    sourcesDone++;

    await appendLog(runId, { type: "source_done", name: sourceName, queued, skipped });
    await updateRun(runId, { sources_done: sourcesDone, queued: totalQueued });
  }

  const queueDepth = Number((await db.execute("SELECT COUNT(*) as cnt FROM pending_items")).rows[0]?.cnt ?? 0);
  await appendLog(runId, {
    type: "done", phase: "fetch-feeds",
    queued: totalQueued, skipped: totalSkipped, queueDepth, hasMore: false, nextOffset: 0,
  });
  await updateRun(runId, { queued: totalQueued, queue_depth: queueDepth });

  console.log(`[unified] Phase 1 done: ${totalQueued} queued, ${totalSkipped} skipped, ${totalErrors} errors`);
  return { queued: totalQueued, skipped: totalSkipped, errors: totalErrors };
}

// ─── Phase 2: Classify ALL pending items ─────────────────────────────────────

async function classifyAllPending(runId: number): Promise<{ added: number; filtered: number; errors: number }> {
  await updateRun(runId, { phase: "classify" });

  const settings = await getSettings();
  const filterInstructions = settings.filter_prompt_override ||
    buildFilterInstructions(parseInt(settings.filter_threshold) || 5);

  let totalAdded = 0, totalFiltered = 0, totalErrors = 0;

  while (true) {
    if (cancelRequested) break;

    const batchResult = await db.execute(`
      SELECT p.id, p.source_id, p.url, p.title, p.snippet, p.source_pub_date,
             s.name AS source_name, s.language AS source_language
      FROM pending_items p
      JOIN sources s ON p.source_id = s.id
      ORDER BY p.id ASC
      LIMIT 50
    `);

    if (batchResult.rows.length === 0) break;

    const queueDepth = Number((await db.execute("SELECT COUNT(*) as cnt FROM pending_items")).rows[0]?.cnt ?? 0);
    await appendLog(runId, { type: "start", phase: "classify", batchSize: batchResult.rows.length, queueDepth });

    console.log(`[unified] Phase 2: Classifying batch of ${batchResult.rows.length} items`);

    for (const row of batchResult.rows) {
      if (cancelRequested) break;

      const id = Number(row.id);
      const sourceId = Number(row.source_id);
      const sourceName = String(row.source_name);
      const sourceLanguage = row.source_language as string | null;
      const itemUrl = String(row.url);
      const title = String(row.title);
      const snippet = (row.snippet as string | null) ?? "";
      const sourcePubDate = (row.source_pub_date as string | null) ?? null;

      try {
        const needsTranslation = !isNativeOutputLanguage(sourceLanguage);
        const provider = await getFilterProvider();
        const prompt = buildFilterPrompt(filterInstructions, title, snippet, needsTranslation);
        const result = await provider.classify(prompt);

        if (!result.fits) {
          const safeCategory = CATEGORY_SLUGS.includes(result.category ?? "other-negative")
            ? (result.category ?? "other-negative")
            : "other-negative";
          try {
            await db.execute({
              sql: `INSERT OR IGNORE INTO rejected_articles
                    (source_id, source_name, url, title, snippet, rejection_reason, rejection_category, source_pub_date, positivity_score)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              args: [sourceId, sourceName, itemUrl, title, snippet.slice(0, 500), result.reason, safeCategory, sourcePubDate, result.score ?? null],
            });
          } catch { /* duplicate */ }
          totalFiltered++;
          await appendLog(runId, { type: "result", verdict: "filtered", title, reason: result.reason, category: safeCategory });
        } else {
          await db.execute({
            sql: `INSERT OR IGNORE INTO raw_articles
                    (source_id, url, title, content, source_pub_date, positivity_score,
                     preview_title_en, preview_snippet_en)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              sourceId, itemUrl, title, snippet, sourcePubDate, result.score ?? null,
              result.preview_title_en ?? null, result.preview_snippet_en ?? null,
            ],
          });
          totalAdded++;
          await appendLog(runId, { type: "result", verdict: "added", title, score: result.score });
        }

        await db.execute({ sql: "DELETE FROM pending_items WHERE id = ?", args: [id] });
      } catch (err) {
        console.warn(`[unified] Error classifying "${title}": ${err}`);
        totalErrors++;
        await db.execute({ sql: "DELETE FROM pending_items WHERE id = ?", args: [id] });
        await appendLog(runId, { type: "result", verdict: "error", title, message: String(err) });
      }

      const remaining = Number((await db.execute("SELECT COUNT(*) as cnt FROM pending_items")).rows[0]?.cnt ?? 0);
      await updateRun(runId, {
        classified: totalAdded + totalFiltered + totalErrors,
        added: totalAdded,
        filtered: totalFiltered,
        errored: totalErrors,
        queue_depth: remaining,
      });
    }

    const remainingDepth = Number((await db.execute("SELECT COUNT(*) as cnt FROM pending_items")).rows[0]?.cnt ?? 0);
    await appendLog(runId, {
      type: "done", phase: "classify",
      added: totalAdded, filtered: totalFiltered, errored: totalErrors,
      processed: totalAdded + totalFiltered + totalErrors,
      queueDepth: remainingDepth, hasMore: remainingDepth > 0,
    });
    await updateRun(runId, { queue_depth: remainingDepth });
  }

  try { await exportRejections(); } catch { /* ok */ }

  console.log(`[unified] Phase 2 done: ${totalAdded} added, ${totalFiltered} filtered, ${totalErrors} errors`);
  return { added: totalAdded, filtered: totalFiltered, errors: totalErrors };
}

// ─── Main unified pipeline ───────────────────────────────────────────────────

export async function runUnifiedPipeline(options?: { isManual?: boolean }): Promise<number | null> {
  if (running) {
    console.log("[unified] Pipeline already running, skipping");
    return activeRunId;
  }

  running = true;
  cancelRequested = false;
  const start = Date.now();

  const settings = await getSettings();
  const mode = settings.positronitron_mode;

  // Count sources for progress display
  const sourceCount = Number(
    (await db.execute("SELECT COUNT(*) as cnt FROM sources WHERE active = 1 AND paused = 0 AND (feed_url IS NOT NULL OR type = 'rss')")).rows[0]?.cnt ?? 0
  );

  const runId = await createRun(sourceCount);
  activeRunId = runId;

  try {
    console.log("[unified] ═══════════════════════════════════════════════════");
    console.log(`[unified] Starting pipeline run #${runId} (mode=${mode})`);
    console.log("[unified] ═══════════════════════════════════════════════════");

    // Phase 1: Fetch all sources
    const fetchResult = await fetchAllSources(runId);
    if (cancelRequested) { await finishRun(runId, "error", "Cancelled by user"); return runId; }

    // Phase 2: Classify all pending
    const classifyResult = await classifyAllPending(runId);
    if (cancelRequested) { await finishRun(runId, "error", "Cancelled by user"); return runId; }

    // Phases 3-5: Only in summarise/full mode
    if (mode === "summarise" || mode === "full") {
      await updateRun(runId, { phase: "positronitron" });
      await appendLog(runId, { type: "phase", label: "Positronitron — selecting and summarising articles" });

      const positronitronResult = await runPositronitron({
        isManual: options?.isManual ?? false,
      });

      if (positronitronResult.selected > 0) {
        console.log(`[unified] Positronitron: ${positronitronResult.selected} articles processed`);

        if (mode === "full") {
          await updateRun(runId, { phase: "publish" });
          const publishResult = await publishScheduledArticles();
          console.log(`[unified] Publish: ${publishResult.published} published, ${publishResult.failed} failed`);

          if (publishResult.published > 0) {
            await updateRun(runId, { phase: "social" });
            const socialResult = await postPendingSocial({ waitForLive: true, maxWaitSeconds: 300 });
            console.log(`[unified] Social: ${socialResult.posted} posted, ${socialResult.skipped} skipped`);
          }
        }
      } else {
        console.log(`[unified] Positronitron: ${positronitronResult.message ?? "no articles selected"}`);

        if (mode === "full") {
          const publishResult = await publishScheduledArticles();
          if (publishResult.published > 0) {
            console.log(`[unified] Publish: ${publishResult.published} published`);
            await updateRun(runId, { phase: "social" });
            const socialResult = await postPendingSocial({ waitForLive: true, maxWaitSeconds: 300 });
            console.log(`[unified] Social: ${socialResult.posted} posted, ${socialResult.skipped} skipped`);
          }
        }
      }
    }

    // Export rejection log
    await updateRun(runId, { phase: "export" });
    await appendLog(runId, { type: "exporting" });
    try {
      const expResult = await exportRejections();
      await appendLog(runId, { type: "exported", count: expResult?.exported ?? 0 });
    } catch (err) {
      await appendLog(runId, { type: "export_error", message: String(err) });
    }

    // Update positivity score chart
    try {
      const { runScoreTracker } = await import("@/lib/score-tracker");
      const scoreResult = await runScoreTracker();
      await appendLog(runId, { type: "scores", scored: scoreResult.scored, skipped: scoreResult.failed });
    } catch (err) {
      console.warn("[unified] Score tracker error:", err instanceof Error ? err.message : err);
    }

    await finishRun(runId, "done");

    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log("[unified] ═══════════════════════════════════════════════════");
    console.log(`[unified] Pipeline #${runId} complete in ${elapsed}s`);
    console.log(`[unified]   Fetched: ${fetchResult.queued} new, ${fetchResult.skipped} known`);
    console.log(`[unified]   Classified: ${classifyResult.added} positive, ${classifyResult.filtered} filtered`);
    console.log("[unified] ═══════════════════════════════════════════════════");
  } catch (err) {
    console.error("[unified] Pipeline error:", err instanceof Error ? err.message : err);
    await finishRun(runId, "error", err instanceof Error ? err.message : String(err));
  } finally {
    running = false;
    activeRunId = null;
  }

  return runId;
}
