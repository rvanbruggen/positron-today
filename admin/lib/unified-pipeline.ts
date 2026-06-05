/**
 * Unified Pipeline — single long-running function for self-hosted mode.
 *
 * Replaces the chunked serverless approach:
 *   1. Fetch ALL RSS sources (no chunk limit)
 *   2. Classify ALL pending items (no batch limit)
 *   3. Run positronitron (pick + summarise + schedule)
 *   4. Publish scheduled articles to GitHub
 *   5. Wait for GitHub Pages deploy
 *   6. Post to social media
 *
 * Only runs in self-hosted deployment mode. Takes as long as it needs.
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

const parser = new RSSParser({ timeout: 8000 });

let running = false;

export function isUnifiedPipelineRunning(): boolean {
  return running;
}

// ─── Phase 1: Fetch ALL sources ──────────────────────────────────────────────

async function fetchAllSources(): Promise<{ queued: number; skipped: number; errors: number }> {
  const allSources = await db.execute(
    "SELECT * FROM sources WHERE active = 1 AND (feed_url IS NOT NULL OR type = 'rss') ORDER BY id ASC",
  );

  console.log(`[unified] Phase 1: Fetching ${allSources.rows.length} sources`);

  let totalQueued = 0, totalSkipped = 0, totalErrors = 0;

  for (const source of allSources.rows) {
    const feedUrl = (source.feed_url ?? source.url) as string;
    let queued = 0, skipped = 0;

    try {
      const feed = await parser.parseURL(feedUrl);
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
        } catch { /* duplicate */ }
      }
    } catch (err) {
      console.warn(`[unified] Error fetching ${source.name}: ${err}`);
      totalErrors++;
    }

    totalQueued += queued;
    totalSkipped += skipped;
  }

  console.log(`[unified] Phase 1 done: ${totalQueued} queued, ${totalSkipped} skipped, ${totalErrors} errors`);
  return { queued: totalQueued, skipped: totalSkipped, errors: totalErrors };
}

// ─── Phase 2: Classify ALL pending items ─────────────────────────────────────

async function classifyAllPending(): Promise<{ added: number; filtered: number; errors: number }> {
  const settings = await getSettings();
  const filterInstructions = settings.filter_prompt_override ||
    buildFilterInstructions(parseInt(settings.filter_threshold) || 5);

  let totalAdded = 0, totalFiltered = 0, totalErrors = 0;

  // Process all pending items in a loop until the queue is empty
  while (true) {
    const batchResult = await db.execute(`
      SELECT p.id, p.source_id, p.url, p.title, p.snippet, p.source_pub_date,
             s.name AS source_name, s.language AS source_language
      FROM pending_items p
      JOIN sources s ON p.source_id = s.id
      ORDER BY p.id ASC
      LIMIT 50
    `);

    if (batchResult.rows.length === 0) break;

    console.log(`[unified] Phase 2: Classifying batch of ${batchResult.rows.length} items`);

    for (const row of batchResult.rows) {
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
                    (source_id, source_name, url, title, snippet, rejection_reason, rejection_category, source_pub_date)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              args: [sourceId, sourceName, itemUrl, title, snippet.slice(0, 500), result.reason, safeCategory, sourcePubDate],
            });
          } catch { /* duplicate */ }
          totalFiltered++;
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
        }

        await db.execute({ sql: "DELETE FROM pending_items WHERE id = ?", args: [id] });
      } catch (err) {
        console.warn(`[unified] Error classifying "${title}": ${err}`);
        totalErrors++;
        // Delete the item to prevent infinite retry loops
        await db.execute({ sql: "DELETE FROM pending_items WHERE id = ?", args: [id] });
      }
    }
  }

  // Export rejection log once at the end
  try { await exportRejections(); } catch { /* ok */ }

  console.log(`[unified] Phase 2 done: ${totalAdded} added, ${totalFiltered} filtered, ${totalErrors} errors`);
  return { added: totalAdded, filtered: totalFiltered, errors: totalErrors };
}

// ─── Main unified pipeline ───────────────────────────────────────────────────

export async function runUnifiedPipeline(options?: { isManual?: boolean }): Promise<void> {
  if (running) {
    console.log("[unified] Pipeline already running, skipping");
    return;
  }

  running = true;
  const start = Date.now();

  try {
    console.log("[unified] ═══════════════════════════════════════════════════");
    console.log("[unified] Starting unified pipeline run");
    console.log("[unified] ═══════════════════════════════════════════════════");

    // Phase 1: Fetch all sources
    const fetchResult = await fetchAllSources();

    // Phase 2: Classify all pending
    const classifyResult = await classifyAllPending();

    // Phase 3: Positronitron — pick, summarise, schedule
    const positronitronResult = await runPositronitron({
      isManual: options?.isManual ?? false,
    });

    if (positronitronResult.selected > 0) {
      console.log(`[unified] Positronitron: ${positronitronResult.selected} articles processed`);

      // Phase 4: Publish scheduled articles
      const publishResult = await publishScheduledArticles();
      console.log(`[unified] Publish: ${publishResult.published} published, ${publishResult.failed} failed`);

      // Phase 5: Wait for deploy and post to social
      if (publishResult.published > 0) {
        console.log("[unified] Waiting 60s for GitHub Pages deploy...");
        await new Promise((r) => setTimeout(r, 60_000));

        const socialResult = await postPendingSocial({ waitForLive: true, maxWaitSeconds: 120 });
        console.log(`[unified] Social: ${socialResult.posted} posted, ${socialResult.skipped} skipped`);
      }
    } else {
      console.log(`[unified] Positronitron: ${positronitronResult.message ?? "no articles selected"}`);

      // Still publish any previously scheduled articles
      const publishResult = await publishScheduledArticles();
      if (publishResult.published > 0) {
        console.log(`[unified] Publish: ${publishResult.published} published`);
        console.log("[unified] Waiting 60s for GitHub Pages deploy...");
        await new Promise((r) => setTimeout(r, 60_000));
        const socialResult = await postPendingSocial({ waitForLive: true, maxWaitSeconds: 120 });
        console.log(`[unified] Social: ${socialResult.posted} posted, ${socialResult.skipped} skipped`);
      }
    }

    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log("[unified] ═══════════════════════════════════════════════════");
    console.log(`[unified] Pipeline complete in ${elapsed}s`);
    console.log(`[unified]   Fetched: ${fetchResult.queued} new, ${fetchResult.skipped} known`);
    console.log(`[unified]   Classified: ${classifyResult.added} positive, ${classifyResult.filtered} filtered`);
    console.log(`[unified]   Positronitron: ${positronitronResult.selected} articles`);
    console.log("[unified] ═══════════════════════════════════════════════════");
  } catch (err) {
    console.error("[unified] Pipeline error:", err instanceof Error ? err.message : err);
  } finally {
    running = false;
  }
}
