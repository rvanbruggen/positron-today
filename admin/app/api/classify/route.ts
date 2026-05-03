import db from "@/lib/db";
import { exportRejections } from "@/lib/export-rejections";
import { getFilterProvider } from "@/lib/llm";
import { buildFilterInstructions, buildFilterPrompt } from "@/lib/prompts";
import { getSettings } from "@/lib/settings";
import { CATEGORY_SLUGS } from "@/lib/rejection-categories";
import { isNativeOutputLanguage } from "@/lib/languages";

// Phase 2 of the two-phase fetch pipeline. Pulls a bounded batch from
// pending_items, runs each through the positivity filter, and routes the
// result into raw_articles (accepted) or rejected_articles (rejected).
// Bounded by `limit` rather than by source count, so timing is predictable
// regardless of how many sources fed the queue.

async function checkPositivity(
  title: string,
  snippet: string,
  filterInstructions: string,
  translateToEnglish: boolean,
): Promise<{
  fits: boolean;
  reason: string;
  category: string;
  score?: number;
  preview_title_en?: string;
  preview_snippet_en?: string;
}> {
  const provider = await getFilterProvider();
  const prompt = buildFilterPrompt(filterInstructions, title, snippet, translateToEnglish);
  const result = await provider.classify(prompt);
  return {
    fits: result.fits,
    reason: result.reason,
    category: result.category ?? "other-negative",
    score: result.score,
    preview_title_en: result.preview_title_en,
    preview_snippet_en: result.preview_snippet_en,
  };
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const isAuto = url.searchParams.get("auto") === "1";

  if (isAuto) {
    const settings = await getSettings();
    if (settings.positronitron_mode === "off") {
      return Response.json({ skipped: true, message: "Positronitron is off. Skipping classify." });
    }
  }

  // Default batch sized so a worst-case run (15 items × ~3s LLM call) stays
  // under the 60s Vercel ceiling. Tune via ?limit= if needed.
  const limit = Math.max(1, parseInt(url.searchParams.get("limit") ?? "15"));

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
        } catch { /* stream already closed */ }
      };

      try {
        const queueDepthBefore = Number(
          (await db.execute("SELECT COUNT(*) AS c FROM pending_items")).rows[0]?.c ?? 0,
        );

        // Pull a batch with the source language joined in — saves N round-trips.
        const batchResult = await db.execute({
          sql: `SELECT p.id, p.source_id, p.url, p.title, p.snippet, p.source_pub_date,
                       s.name AS source_name, s.language AS source_language
                FROM pending_items p
                JOIN sources s ON p.source_id = s.id
                ORDER BY p.id ASC
                LIMIT ?`,
          args: [limit],
        });
        const batch = batchResult.rows;

        send({
          type: "start",
          phase: "classify",
          batchSize: batch.length,
          queueDepth: queueDepthBefore,
        });

        const settings = await getSettings();
        const filterInstructions = settings.filter_prompt_override ||
          buildFilterInstructions(parseInt(settings.filter_threshold) || 5);

        let added = 0, filtered = 0, errored = 0;

        for (const row of batch) {
          const id = Number(row.id);
          const sourceId = Number(row.source_id);
          const sourceName = String(row.source_name);
          const sourceLanguage = row.source_language as string | null;
          const itemUrl = String(row.url);
          const title = String(row.title);
          const snippet = (row.snippet as string | null) ?? "";
          const sourcePubDate = (row.source_pub_date as string | null) ?? null;

          send({ type: "item", title, source: sourceName });

          try {
            const needsTranslation = !isNativeOutputLanguage(sourceLanguage);
            const { fits, reason, category, score, preview_title_en, preview_snippet_en } =
              await checkPositivity(title, snippet, filterInstructions, needsTranslation);

            if (!fits) {
              const safeCategory = CATEGORY_SLUGS.includes(category) ? category : "other-negative";
              try {
                await db.execute({
                  sql: `INSERT OR IGNORE INTO rejected_articles
                        (source_id, source_name, url, title, snippet, rejection_reason, rejection_category, source_pub_date)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                  args: [sourceId, sourceName, itemUrl, title, snippet.slice(0, 500), reason, safeCategory, sourcePubDate],
                });
              } catch { /* duplicate */ }
              filtered++;
              send({ type: "result", verdict: "filtered", title, reason, category, score });
            } else {
              await db.execute({
                sql: `INSERT INTO raw_articles
                        (source_id, url, title, content, source_pub_date, positivity_score,
                         preview_title_en, preview_snippet_en)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                args: [
                  sourceId, itemUrl, title, snippet, sourcePubDate, score ?? null,
                  preview_title_en ?? null, preview_snippet_en ?? null,
                ],
              });
              added++;
              send({ type: "result", verdict: "added", title, score });
            }

            // Remove from queue once classification has been persisted.
            await db.execute({ sql: "DELETE FROM pending_items WHERE id = ?", args: [id] });
          } catch (err) {
            // Leave the item in the queue so a future run can retry. Surface the error.
            errored++;
            send({ type: "result", verdict: "error", title, message: String(err) });
          }
        }

        const queueDepthAfter = Number(
          (await db.execute("SELECT COUNT(*) AS c FROM pending_items")).rows[0]?.c ?? 0,
        );
        const hasMore = queueDepthAfter > 0;

        send({
          type: "done",
          phase: "classify",
          added,
          filtered,
          errored,
          processed: batch.length,
          queueDepth: queueDepthAfter,
          hasMore,
        });

        // Drain rejections to the public log only when the queue is empty —
        // ensures one consolidated export per full cycle rather than per batch.
        if (!hasMore && batch.length > 0) {
          try {
            send({ type: "exporting" });
            const { exported } = await exportRejections();
            send({ type: "exported", count: exported });
          } catch (err) {
            send({ type: "export_error", message: String(err) });
          }
        }
      } catch (err) {
        send({ type: "fatal", message: String(err) });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}
