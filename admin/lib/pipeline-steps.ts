import db from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { exportRejections } from "@/lib/export-rejections";
import { getFilterProvider } from "@/lib/llm";
import { buildFilterInstructions, buildFilterPrompt } from "@/lib/prompts";
import { CATEGORY_SLUGS } from "@/lib/rejection-categories";
import { isNativeOutputLanguage } from "@/lib/languages";
import RSSParser from "rss-parser";

const FETCH_CHUNK = 15;
const CLASSIFY_BATCH = 15;
const parser = new RSSParser({ timeout: 8000 });

export async function appendLog(runId: number, entries: object[]) {
  const current = await db.execute({
    sql: "SELECT log FROM pipeline_runs WHERE id = ?",
    args: [runId],
  });
  const existing: object[] = JSON.parse(String(current.rows[0]?.log ?? "[]"));
  existing.push(...entries);
  await db.execute({
    sql: "UPDATE pipeline_runs SET log = ? WHERE id = ?",
    args: [JSON.stringify(existing), runId],
  });
}

export async function updateRun(runId: number, fields: Record<string, string | number | null>) {
  const keys = Object.keys(fields);
  const sets = keys.map(k => `"${k}" = ?`).join(", ");
  const args: (string | number | null)[] = keys.map(k => fields[k]);
  args.push(runId);
  await db.execute({ sql: `UPDATE pipeline_runs SET ${sets} WHERE id = ?`, args });
}

// ── Phase 1: fetch one chunk of RSS feeds into pending_items ──────────────
export async function runFetchChunk(runId: number, offset: number) {
  const logEntries: object[] = [];
  const log = (entry: object) => logEntries.push(entry);

  const allSourcesResult = await db.execute(
    "SELECT * FROM sources WHERE active = 1 AND (feed_url IS NOT NULL OR type = 'rss') ORDER BY id ASC",
  );
  const totalSources = allSourcesResult.rows.length;
  const sources = allSourcesResult.rows.slice(offset, offset + FETCH_CHUNK);

  log({ type: "start", phase: "fetch-feeds", totalSources, chunkSize: sources.length, offset, hasMore: offset + FETCH_CHUNK < totalSources });

  let chunkQueued = 0, chunkSkipped = 0;

  for (const source of sources) {
    const feedUrl = (source.feed_url ?? source.url) as string;
    log({ type: "source", name: source.name as string, url: feedUrl });

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

        if (existingPending.rows.length > 0 || existingRaw.rows.length > 0 || existingRejected.rows.length > 0 || existingArticle.rows.length > 0) {
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
          log({ type: "item", verdict: "queued", title: item.title! });
        } catch { /* duplicate */ }
      }
      log({ type: "source_done", name: source.name as string, queued, skipped });
    } catch (err) {
      log({ type: "source_error", name: source.name as string, message: String(err) });
    }
    chunkQueued += queued;
    chunkSkipped += skipped;
  }

  const hasMore = offset + FETCH_CHUNK < totalSources;
  const nextOffset = hasMore ? offset + FETCH_CHUNK : 0;

  const queueDepthResult = await db.execute("SELECT COUNT(*) AS c FROM pending_items");
  const queueDepth = Number(queueDepthResult.rows[0]?.c ?? 0);

  log({ type: "done", phase: "fetch-feeds", queued: chunkQueued, skipped: chunkSkipped, hasMore, nextOffset, queueDepth });

  const prevQueued = Number((await db.execute({ sql: "SELECT queued FROM pipeline_runs WHERE id = ?", args: [runId] })).rows[0]?.queued ?? 0);
  const prevSourcesDone = Number((await db.execute({ sql: "SELECT sources_done FROM pipeline_runs WHERE id = ?", args: [runId] })).rows[0]?.sources_done ?? 0);

  await updateRun(runId, {
    offset: nextOffset,
    sources_done: prevSourcesDone + sources.length,
    queued: prevQueued + chunkQueued,
    queue_depth: queueDepth,
  });
  await appendLog(runId, logEntries);
}

// ── Phase 2: classify one batch of pending_items via LLM ──────────────────
export async function runClassifyBatch(runId: number) {
  const logEntries: object[] = [];
  const log = (entry: object) => logEntries.push(entry);

  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const claimToken = now + "-" + Math.random().toString(36).slice(2, 8);

  // Atomically claim unclaimed rows so concurrent batches can't pick the same items
  await db.execute({
    sql: `UPDATE pending_items SET claimed_at = ?
          WHERE id IN (
            SELECT id FROM pending_items WHERE claimed_at IS NULL ORDER BY id ASC LIMIT ?
          )`,
    args: [claimToken, CLASSIFY_BATCH],
  });

  const queueDepthBefore = Number(
    (await db.execute("SELECT COUNT(*) AS c FROM pending_items WHERE claimed_at IS NULL")).rows[0]?.c ?? 0,
  );

  const batchResult = await db.execute({
    sql: `SELECT p.id, p.source_id, p.url, p.title, p.snippet, p.source_pub_date,
                 s.name AS source_name, s.language AS source_language
          FROM pending_items p
          JOIN sources s ON p.source_id = s.id
          WHERE p.claimed_at = ?
          ORDER BY p.id ASC`,
    args: [claimToken],
  });
  const batch = batchResult.rows;

  log({ type: "start", phase: "classify", batchSize: batch.length, queueDepth: queueDepthBefore });

  if (batch.length === 0) {
    log({ type: "done", phase: "classify", added: 0, filtered: 0, errored: 0, processed: 0, queueDepth: 0, hasMore: false });
    await appendLog(runId, logEntries);
    await updateRun(runId, { queue_depth: 0 });
    return;
  }

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

    try {
      const needsTranslation = !isNativeOutputLanguage(sourceLanguage);
      const provider = await getFilterProvider();
      const prompt = buildFilterPrompt(filterInstructions, title, snippet, needsTranslation);
      const result = await provider.classify(prompt);

      const fits = result.fits;
      const reason = result.reason;
      const category = result.category ?? "other-negative";
      const score = result.score;
      const preview_title_en = result.preview_title_en;
      const preview_snippet_en = result.preview_snippet_en;

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
        log({ type: "result", verdict: "filtered", title, reason, category, score });
      } else {
        await db.execute({
          sql: `INSERT OR IGNORE INTO raw_articles
                  (source_id, url, title, content, source_pub_date, positivity_score,
                   preview_title_en, preview_snippet_en)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            sourceId, itemUrl, title, snippet, sourcePubDate, score ?? null,
            preview_title_en ?? null, preview_snippet_en ?? null,
          ],
        });
        added++;
        log({ type: "result", verdict: "added", title, score });
      }

      await db.execute({ sql: "DELETE FROM pending_items WHERE id = ?", args: [id] });
    } catch (err) {
      errored++;
      log({ type: "result", verdict: "error", title, message: String(err) });
    }
  }

  const queueDepthAfter = Number(
    (await db.execute("SELECT COUNT(*) AS c FROM pending_items WHERE claimed_at IS NULL")).rows[0]?.c ?? 0,
  );
  const hasMore = queueDepthAfter > 0;

  log({ type: "done", phase: "classify", added, filtered, errored, processed: batch.length, queueDepth: queueDepthAfter, hasMore });

  const run = (await db.execute({ sql: "SELECT added, filtered, errored, classified FROM pipeline_runs WHERE id = ?", args: [runId] })).rows[0]!;
  await updateRun(runId, {
    added: Number(run.added) + added,
    filtered: Number(run.filtered) + filtered,
    errored: Number(run.errored) + errored,
    classified: Number(run.classified) + batch.length,
    queue_depth: queueDepthAfter,
  });
  await appendLog(runId, logEntries);
}

// ── Phase 3: export rejection log ─────────────────────────────────────────
export async function runExport(runId: number) {
  const logEntries: object[] = [];
  const log = (entry: object) => logEntries.push(entry);

  try {
    log({ type: "exporting" });
    const { exported } = await exportRejections();
    log({ type: "exported", count: exported });
  } catch (err) {
    log({ type: "export_error", message: String(err) });
  }

  await appendLog(runId, logEntries);
}
