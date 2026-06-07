import db from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { exportRejections } from "@/lib/export-rejections";
import { getFilterProvider } from "@/lib/llm";
import { buildFilterInstructions, buildFilterPrompt } from "@/lib/prompts";
import { CATEGORY_SLUGS } from "@/lib/rejection-categories";
import { isNativeOutputLanguage } from "@/lib/languages";
import RSSParser from "rss-parser";

const FETCH_CHUNK = 5;
const CLASSIFY_BATCH = 1;
const parser = new RSSParser({ timeout: 8000 });

/**
 * Create a new pipeline run with fetch_chunk + plan_classify tasks.
 * Returns the runId, or null if a run is already active (and not stale).
 */
export async function startPipelineRun(): Promise<{ runId: number } | { error: string; runId?: number }> {
  const existing = await db.execute(
    "SELECT id, started_at FROM pipeline_runs WHERE status = 'running' LIMIT 1",
  );
  if (existing.rows.length > 0) {
    const startedAt = existing.rows[0].started_at
      ? new Date(String(existing.rows[0].started_at)).getTime()
      : 0;
    const ageMs = Date.now() - startedAt;
    if (ageMs > 10 * 60 * 1000) {
      await db.execute({
        sql: `UPDATE pipeline_runs
              SET status = 'error', error_message = 'Timed out (stale run)', finished_at = datetime('now')
              WHERE id = ?`,
        args: [existing.rows[0].id],
      });
      await db.execute("DELETE FROM pending_items");
      await db.execute({
        sql: "UPDATE pipeline_tasks SET status = 'error' WHERE run_id = ? AND status IN ('pending', 'running')",
        args: [existing.rows[0].id],
      });
    } else {
      return { error: "A pipeline run is already in progress.", runId: Number(existing.rows[0].id) };
    }
  }

  await db.execute("DELETE FROM pending_items");

  const totalResult = await db.execute(
    "SELECT COUNT(*) AS c FROM sources WHERE active = 1 AND (feed_url IS NOT NULL OR type = 'rss')",
  );
  const totalSources = Number(totalResult.rows[0]?.c ?? 0);

  const result = await db.execute({
    sql: `INSERT INTO pipeline_runs (status, phase, total_sources) VALUES ('running', 'fetch', ?)`,
    args: [totalSources],
  });
  const runId = Number(result.lastInsertRowid);

  const numChunks = Math.max(1, Math.ceil(totalSources / FETCH_CHUNK));
  for (let i = 0; i < numChunks; i++) {
    await db.execute({
      sql: `INSERT INTO pipeline_tasks (run_id, kind, seq, payload) VALUES (?, 'fetch_chunk', ?, ?)`,
      args: [runId, i, JSON.stringify({ offset: i * FETCH_CHUNK })],
    });
  }
  await db.execute({
    sql: `INSERT INTO pipeline_tasks (run_id, kind, seq) VALUES (?, 'plan_classify', ?)`,
    args: [runId, numChunks],
  });

  return { runId };
}

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

// ── Shared tick logic (used by both the API route and the scheduler) ─────

async function planClassifyTasks(runId: number) {
  const countResult = await db.execute("SELECT COUNT(*) AS c FROM pending_items WHERE claimed_at IS NULL");
  const pendingCount = Number(countResult.rows[0]?.c ?? 0);

  const maxSeqResult = await db.execute({
    sql: "SELECT MAX(seq) AS m FROM pipeline_tasks WHERE run_id = ?",
    args: [runId],
  });
  const nextSeq = Number(maxSeqResult.rows[0]?.m ?? 0) + 1;

  if (pendingCount > 0) {
    await db.execute({
      sql: `INSERT INTO pipeline_tasks (run_id, kind, seq) VALUES (?, 'classify_batch', ?)`,
      args: [runId, nextSeq],
    });
    await updateRun(runId, { phase: "classify" });
  } else {
    await db.execute({
      sql: `INSERT INTO pipeline_tasks (run_id, kind, seq) VALUES (?, 'export', ?)`,
      args: [runId, nextSeq],
    });
    await updateRun(runId, { phase: "export" });
  }
}

async function enqueueNextAfterClassify(runId: number) {
  const remaining = Number(
    (await db.execute("SELECT COUNT(*) AS c FROM pending_items WHERE claimed_at IS NULL")).rows[0]?.c ?? 0,
  );

  const alreadyQueued = await db.execute({
    sql: `SELECT id FROM pipeline_tasks
          WHERE run_id = ? AND status = 'pending' AND kind IN ('classify_batch', 'export')
          LIMIT 1`,
    args: [runId],
  });
  if (alreadyQueued.rows.length > 0) return;

  const maxSeqResult = await db.execute({
    sql: "SELECT MAX(seq) AS m FROM pipeline_tasks WHERE run_id = ?",
    args: [runId],
  });
  const nextSeq = Number(maxSeqResult.rows[0]?.m ?? 0) + 1;

  if (remaining > 0) {
    await db.execute({
      sql: `INSERT INTO pipeline_tasks (run_id, kind, seq) VALUES (?, 'classify_batch', ?)`,
      args: [runId, nextSeq],
    });
  } else {
    await db.execute({
      sql: `INSERT INTO pipeline_tasks (run_id, kind, seq) VALUES (?, 'export', ?)`,
      args: [runId, nextSeq],
    });
  }
}

/**
 * Execute one pending task for a pipeline run. Returns the run status.
 */
export async function runOneTick(runId: number): Promise<"running" | "done" | "error"> {
  await db.execute(
    "UPDATE pending_items SET claimed_at = NULL WHERE claimed_at IS NOT NULL AND claimed_at < datetime('now', '-90 seconds')",
  );

  const runResult = await db.execute({
    sql: "SELECT status FROM pipeline_runs WHERE id = ?",
    args: [runId],
  });
  if (runResult.rows.length === 0) return "error";
  const status = String(runResult.rows[0].status);
  if (status !== "running") return status as "done" | "error";

  await db.execute({
    sql: `UPDATE pipeline_tasks SET status = 'pending', started_at = NULL
          WHERE run_id = ? AND status = 'running'
            AND started_at < datetime('now', '-90 seconds')`,
    args: [runId],
  });

  const taskResult = await db.execute({
    sql: `SELECT id, kind, payload FROM pipeline_tasks
          WHERE run_id = ? AND status = 'pending'
          ORDER BY seq ASC, id ASC LIMIT 1`,
    args: [runId],
  });

  if (taskResult.rows.length === 0) {
    const stillRunning = await db.execute({
      sql: `SELECT id FROM pipeline_tasks WHERE run_id = ? AND status = 'running' LIMIT 1`,
      args: [runId],
    });
    if (stillRunning.rows.length === 0) {
      await updateRun(runId, {
        status: "done",
        finished_at: new Date().toISOString().replace("T", " ").slice(0, 19),
      });
      return "done";
    }
    return "running";
  }

  const task = taskResult.rows[0];
  const taskId = Number(task.id);
  const kind = task.kind as string;
  const payload = JSON.parse(String(task.payload ?? "{}"));

  const claim = await db.execute({
    sql: `UPDATE pipeline_tasks SET status = 'running', started_at = datetime('now')
          WHERE id = ? AND status = 'pending'`,
    args: [taskId],
  });
  if (claim.rowsAffected === 0) return "running";

  try {
    if (kind === "fetch_chunk") {
      await updateRun(runId, { phase: "fetch" });
      await runFetchChunk(runId, payload.offset ?? 0);
    } else if (kind === "plan_classify") {
      await planClassifyTasks(runId);
    } else if (kind === "classify_batch") {
      await updateRun(runId, { phase: "classify" });
      await runClassifyBatch(runId);
      await enqueueNextAfterClassify(runId);
    } else if (kind === "export") {
      await updateRun(runId, { phase: "export" });
      await runExport(runId);
    }

    await db.execute({
      sql: "UPDATE pipeline_tasks SET status = 'done', finished_at = datetime('now') WHERE id = ?",
      args: [taskId],
    });
  } catch (err) {
    await db.execute({
      sql: "UPDATE pipeline_tasks SET status = 'error', error = ?, finished_at = datetime('now') WHERE id = ?",
      args: [String(err), taskId],
    });
    await appendLog(runId, [{ type: "fatal", message: String(err) }]);
    await updateRun(runId, {
      status: "error",
      error_message: String(err),
      finished_at: new Date().toISOString().replace("T", " ").slice(0, 19),
    });
    return "error";
  }

  return "running";
}

/**
 * Run the chunked pipeline to completion. Creates a pipeline_run visible in the UI,
 * then drains all tasks sequentially.
 */
export async function drainPipeline(): Promise<void> {
  const result = await startPipelineRun();
  if ("error" in result) {
    console.log(`[pipeline] Cannot start: ${result.error}`);
    return;
  }

  const { runId } = result;
  console.log(`[pipeline] Started run ${runId}, draining tasks…`);

  while (true) {
    const status = await runOneTick(runId);
    if (status === "done") {
      console.log(`[pipeline] Run ${runId} complete`);
      break;
    }
    if (status === "error") {
      console.error(`[pipeline] Run ${runId} failed`);
      break;
    }
  }
}
