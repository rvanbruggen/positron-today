"use client";

import { useEffect, useRef, useState } from "react";

type DuplicateHint = {
  id:           number;
  title:        string;
  source_name:  string;
  origin:       "pending" | "draft" | "scheduled" | "published";
  similarity:   number;      // 0–1
  shared_tokens: number;
  published_at: string | null;
};

type RawArticle = {
  id: number;
  source_name: string;
  source_language: string;
  url: string;
  title: string;
  content: string;
  fetched_at: string;
  status: string;
  duplicate_of: DuplicateHint | null;
  preview_title_en: string | null;
  preview_snippet_en: string | null;
};

const ORIGIN_LABELS: Record<DuplicateHint["origin"], string> = {
  pending:   "another article in this queue",
  draft:     "a draft article",
  scheduled: "a scheduled article",
  published: "a published article",
};

// Log events emitted by the server-side pipeline (stored in pipeline_runs.log).
// The UI polls /api/pipeline/status and renders these.
type LogLine =
  // Phase 1 events
  | { type: "start"; phase: "fetch-feeds"; totalSources: number; chunkSize?: number; offset?: number; hasMore?: boolean }
  | { type: "source"; name: string; url: string }
  | { type: "item"; verdict?: "queued"; title: string; source?: string }
  | { type: "source_done"; name: string; queued: number; skipped: number }
  | { type: "source_error"; name: string; message: string }
  | { type: "done"; phase: "fetch-feeds"; queued: number; skipped: number; hasMore: boolean; nextOffset: number; queueDepth: number }
  // Phase 2 events
  | { type: "start"; phase: "classify"; batchSize: number; queueDepth: number }
  | { type: "result"; verdict: "added" | "filtered" | "error"; title: string; reason?: string; message?: string; score?: number; category?: string }
  | { type: "done"; phase: "classify"; added: number; filtered: number; errored: number; processed: number; queueDepth: number; hasMore: boolean }
  // Shared / sectioning events
  | { type: "phase"; label: string }
  | { type: "exporting" }
  | { type: "exported"; count: number }
  | { type: "export_error"; message: string }
  | { type: "fatal"; message: string };

export default function PreviewPage() {
  const [articles, setArticles] = useState<RawArticle[]>([]);
  const [fetching, setFetching] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [progress, setProgress] = useState(0); // 0–100
  const [totalSources, setTotalSources] = useState(0);
  const [sourcesDone, setSourcesDone] = useState(0);
  const [manualUrl, setManualUrl] = useState("");
  const [manualLoading, setManualLoading] = useState(false);
  const [manualResult, setManualResult] = useState<{ ok: boolean; message: string } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickInFlight = useRef(false);
  const [activeRunId, setActiveRunId] = useState<number | null>(null);

  async function load() {
    const res = await fetch("/api/articles?status=pending");
    setArticles(await res.json());
  }
  useEffect(() => { load(); }, []);

  // Auto-scroll log to bottom as lines arrive
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  // On mount, check for a recent pipeline run (running, error, or done).
  // If still running: resume ticking. If recently finished/errored: show the final state
  // so the user sees what happened while the tab was closed.
  useEffect(() => {
    (async () => {
      try {
        const statusRes = await fetch("/api/pipeline/status");
        const statusData = await statusRes.json();
        const check = statusData.run ?? statusData;
        if (!check?.id) return;

        const runId = Number(check.id);

        if (check.status === "running") {
          // Auto-stop stale runs (>10 min since start)
          const startedAt = check.started_at ? new Date(check.started_at).getTime() : 0;
          if (Date.now() - startedAt > 10 * 60 * 1000) {
            await fetch("/api/pipeline/stop", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ runId }),
            });
            return;
          }
          setFetching(true);
          setActiveRunId(runId);
          setTotalSources(Number(check.total_sources ?? 0));
          setSourcesDone(Number(check.sources_done ?? 0));
          startPolling(runId);
          return;
        }

        // Show recent error/done runs so the user sees what happened.
        // Only show if finished within the last 10 minutes.
        const finishedAt = check.finished_at ? new Date(check.finished_at).getTime() : 0;
        if (finishedAt && Date.now() - finishedAt < 10 * 60 * 1000) {
          // Fetch full run with logs
          const fullRes = await fetch(`/api/pipeline/status?runId=${runId}&t=${Date.now()}`);
          const full = await fullRes.json();
          const runLogs: LogLine[] = Array.isArray(full.log) ? full.log : JSON.parse(String(full.log ?? "[]"));

          if (full.status === "error" && full.error_message && runLogs.length === 0) {
            setLogs([{ type: "fatal", message: full.error_message }]);
          } else {
            setLogs(runLogs);
          }
          setTotalSources(Number(full.total_sources ?? 0));
          setSourcesDone(Number(full.sources_done ?? 0));
          setProgress(full.status === "done" ? 100 : 0);
          load();
        }
      } catch { /* ignore */ }
    })();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  function startPolling(runId: number) {
    if (pollRef.current) clearInterval(pollRef.current);

    const tick = async () => {
      if (tickInFlight.current) return;
      tickInFlight.current = true;
      try {
        const res = await fetch("/api/pipeline/tick", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId }),
        });
        const run = await res.json();
        if (!run || run.error) return;

        const runLogs: LogLine[] = Array.isArray(run.log) ? run.log : JSON.parse(String(run.log ?? "[]"));
        setLogs(runLogs);

        const total = Number(run.total_sources ?? 0);
        const done = Number(run.sources_done ?? 0);
        const classified = Number(run.classified ?? 0);
        const queueDepth = Number(run.queue_depth ?? 0);

        setTotalSources(total);
        setSourcesDone(done);

        if (run.phase === "fetch" || run.phase === "fetch-feeds") {
          setProgress(total > 0 ? Math.round((done / total) * 50) : 0);
        } else if (run.phase === "classify") {
          const classifyTotal = classified + queueDepth;
          const classifyPct = classifyTotal > 0 ? Math.round((classified / classifyTotal) * 50) : 0;
          setProgress(50 + classifyPct);
        } else if (run.phase === "export") {
          setProgress(95);
        }

        if (run.status === "done" || run.status === "error") {
          if (run.status === "error" && run.error_message && runLogs.length === 0) {
            setLogs([{ type: "fatal", message: run.error_message }]);
          }
          setProgress(run.status === "done" ? 100 : progress);
          setFetching(false);
          setActiveRunId(null);
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          load();
        }
      } catch { /* network hiccup, keep polling */ }
      finally { tickInFlight.current = false; }
    };

    tick();
    pollRef.current = setInterval(tick, 2000);
  }

  async function fetchNew() {
    setFetching(true);
    setLogs([]);
    setProgress(0);
    setTotalSources(0);
    setSourcesDone(0);

    try {
      const res = await fetch("/api/pipeline/start", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        if (data.runId) {
          setActiveRunId(data.runId);
          startPolling(data.runId);
          return;
        }
        setLogs([{ type: "fatal", message: data.error ?? `Error ${res.status}` }]);
        setFetching(false);
        return;
      }

      setActiveRunId(data.runId);
      startPolling(data.runId);
    } catch (err) {
      setLogs([{ type: "fatal", message: String(err) }]);
      setFetching(false);
    }
  }

  async function stopPipeline() {
    if (!activeRunId) return;
    try {
      await fetch("/api/pipeline/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: activeRunId }),
      });
    } catch { /* polling will pick up the state change */ }
  }

  async function addManualUrl(e: React.FormEvent) {
    e.preventDefault();
    if (!manualUrl.trim()) return;
    setManualLoading(true);
    setManualResult(null);
    try {
      const res = await fetch("/api/manual-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: manualUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setManualResult({ ok: false, message: data.error ?? `Error ${res.status}` });
      } else {
        setManualResult({ ok: true, message: `Added: "${data.title}"` });
        setManualUrl("");
        load();
      }
    } catch (err) {
      setManualResult({ ok: false, message: err instanceof Error ? err.message : "Unknown error" });
    }
    setManualLoading(false);
  }

  async function updateStatus(id: number, status: "approved" | "discarded") {
    await fetch("/api/articles", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    setArticles(prev => prev.filter(a => a.id !== id));
  }

  const isCancelled = logs.some(l => l.type === "fatal" && "message" in l && l.message === "Cancelled by user");
  const isDone = isCancelled || logs.some(l => l.type === "exported" || l.type === "export_error" || l.type === "fatal");
  // Aggregate counters across all phases for the bottom summary bar
  const totals = logs.reduce(
    (acc, l) => {
      if (l.type === "done" && l.phase === "fetch-feeds") {
        acc.queued += l.queued;
        acc.skipped += l.skipped;
      } else if (l.type === "done" && l.phase === "classify") {
        acc.added += l.added;
        acc.filtered += l.filtered;
        acc.errored += l.errored;
      }
      return acc;
    },
    { queued: 0, skipped: 0, added: 0, filtered: 0, errored: 0 },
  );
  const hasAnyDone = logs.some((l): l is Extract<LogLine, { type: "done" }> => l.type === "done");

  return (
    <div>
      <div className="flex items-center justify-between mb-1 gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-amber-900">Preview</h1>
        <div className="flex gap-2">
          {fetching && (
            <button
              onClick={stopPipeline}
              className="bg-red-500 hover:bg-red-600 text-white font-medium px-4 py-2 rounded-lg text-sm transition-colors"
            >
              Stop
            </button>
          )}
          <button
            onClick={fetchNew}
            disabled={fetching}
            className="bg-yellow-400 hover:bg-yellow-500 text-amber-900 font-medium px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            {fetching ? "Fetching…" : "Fetch new articles"}
          </button>
        </div>
      </div>
      <p className="text-amber-700 text-sm mb-4">
        Review incoming articles. Approve the ones worth summarising, discard the rest.
      </p>

      {/* Manual URL input */}
      <form onSubmit={addManualUrl} className="bg-white rounded-xl px-5 py-4 shadow-sm border border-yellow-200 mb-4 flex gap-3 items-center">
        <input
          type="url"
          placeholder="Paste a URL to add manually…"
          value={manualUrl}
          onChange={e => { setManualUrl(e.target.value); setManualResult(null); }}
          className="flex-1 border border-yellow-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-yellow-400 text-amber-900 placeholder:text-amber-300"
        />
        <button
          type="submit"
          disabled={manualLoading || !manualUrl.trim()}
          className="bg-yellow-400 hover:bg-yellow-500 text-amber-900 font-medium px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50 shrink-0"
        >
          {manualLoading ? "Adding…" : "Add URL"}
        </button>
      </form>
      {manualResult && (
        <div className={`rounded-lg px-4 py-2 text-sm mb-4 ${manualResult.ok ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-700"}`}>
          {manualResult.message}
        </div>
      )}

      {/* ── Fetch log panel ── */}
      {(fetching || logs.length > 0) && (
        <div className="bg-amber-950 rounded-xl mb-6 overflow-hidden shadow-lg">

          {/* Progress bar */}
          <div className="px-4 pt-3 pb-2">
            <div className="flex items-center justify-between text-xs text-amber-400 mb-1.5">
              <span>
                {fetching
                  ? progress < 50
                    ? totalSources === 0
                      ? "Starting…"
                      : `Phase 1 — scanning source ${Math.min(sourcesDone + 1, totalSources)} of ${totalSources}…`
                    : progress < 100
                      ? "Phase 2 — classifying queued items…"
                      : "Finalising…"
                  : isCancelled ? "Stopped by user" : isDone ? "Fetch complete" : "Ready"}
              </span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 bg-amber-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-yellow-400 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Log lines */}
          <div
            ref={logRef}
            className="px-4 pb-4 font-mono text-xs leading-relaxed overflow-y-auto max-h-72"
          >
            {logs.map((line, i) => {
              if (line.type === "phase")
                return <div key={i} className="text-yellow-200 font-bold mt-3 border-t border-amber-800 pt-2">▸ {line.label}</div>;
              if (line.type === "start" && line.phase === "fetch-feeds")
                return <div key={i} className="text-amber-400 mt-1">Found {line.totalSources} sources — scanning chunk of {line.chunkSize ?? "?"}</div>;
              if (line.type === "start" && line.phase === "classify")
                return <div key={i} className="text-amber-400 mt-1">Queue depth: {line.queueDepth} — classifying batch of {line.batchSize}</div>;
              if (line.type === "source")
                return <div key={i} className="text-yellow-300 font-semibold mt-2">📡 {line.name}</div>;
              if (line.type === "item" && line.verdict === "queued")
                return <div key={i} className="text-blue-300 pl-3">⏳ {line.title}</div>;
              if (line.type === "item")
                return <div key={i} className="text-amber-300 pl-3">→ {line.title}{line.source ? <span className="text-amber-500"> · {line.source}</span> : null}</div>;
              if (line.type === "result" && line.verdict === "added")
                return <div key={i} className="text-green-400 pl-3">✓ {line.title}</div>;
              if (line.type === "result" && line.verdict === "filtered")
                return <div key={i} className="text-red-400 pl-3">✗ {line.title}{line.reason ? <span className="text-red-600"> — {line.reason}</span> : null}</div>;
              if (line.type === "result" && line.verdict === "error")
                return <div key={i} className="text-orange-400 pl-3">⚠ {line.title}{line.message ? <span className="text-orange-600"> — {line.message}</span> : null}</div>;
              if (line.type === "source_done")
                return <div key={i} className="text-amber-600 pl-3 pb-1">↳ +{line.queued} queued · {line.skipped} already known</div>;
              if (line.type === "source_error")
                return <div key={i} className="text-orange-400 pl-3">⚠ {line.name}: {line.message}</div>;
              if (line.type === "done" && line.phase === "fetch-feeds")
                return <div key={i} className="text-green-300 font-semibold mt-2">✅ Phase 1 chunk done — {line.queued} queued · {line.skipped} skipped · queue depth {line.queueDepth}</div>;
              if (line.type === "done" && line.phase === "classify")
                return <div key={i} className="text-green-300 font-semibold mt-2">✅ Phase 2 batch done — {line.added} added · {line.filtered} filtered{line.errored ? ` · ${line.errored} errored` : ""} · queue depth {line.queueDepth}</div>;
              if (line.type === "fatal")
                return <div key={i} className="text-red-300 font-semibold mt-2">💥 {line.message}</div>;
              if (line.type === "exporting")
                return <div key={i} className="text-amber-400 mt-2">📤 Publishing rejection log to public site…</div>;
              if (line.type === "exported")
                return <div key={i} className="text-green-400">✓ Public rejection log updated ({line.count} articles)</div>;
              if (line.type === "export_error")
                return <div key={i} className="text-orange-400">⚠ Could not update public site: {line.message}</div>;
              return null;
            })}
            {fetching && <div className="text-amber-700 animate-pulse mt-1">▌</div>}
          </div>

          {/* Summary bar — aggregates Phase 1 + Phase 2 totals across all chunks/batches */}
          {hasAnyDone && (
            <div className="border-t border-amber-800 px-4 py-2 flex gap-4 text-xs">
              <span className="text-green-400 font-semibold">+{totals.added} added</span>
              <span className="text-red-400">{totals.filtered} filtered</span>
              <span className="text-blue-300">{totals.queued} queued</span>
              <span className="text-amber-600">{totals.skipped} skipped</span>
              {totals.errored > 0 && <span className="text-orange-400">{totals.errored} errored</span>}
            </div>
          )}
        </div>
      )}

      {/* Article list */}
      <div className="flex flex-col gap-4">
        {articles.length === 0 && !fetching && (
          <p className="text-amber-600 text-sm">
            No pending articles. Hit "Fetch new articles" to pull from your sources, or paste a URL above.
          </p>
        )}
        {articles.map(article => (
          <div key={article.id}
            className={`bg-white rounded-xl p-5 shadow-sm border ${article.duplicate_of ? "border-orange-300 ring-1 ring-orange-100" : "border-yellow-200"}`}>
            {article.duplicate_of && (
              <div className="mb-3 flex items-start gap-2 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 text-xs text-orange-800">
                <span className="shrink-0">⚠</span>
                <div className="min-w-0">
                  <p className="font-semibold">
                    Possible duplicate of {ORIGIN_LABELS[article.duplicate_of.origin]}
                    {" · "}
                    <span className="font-normal">{Math.round(article.duplicate_of.similarity * 100)}% similarity ({article.duplicate_of.shared_tokens} words shared)</span>
                  </p>
                  <p className="mt-0.5 text-orange-700 truncate">
                    <span className="italic">&ldquo;{article.duplicate_of.title}&rdquo;</span>
                    <span className="text-orange-500"> — {article.duplicate_of.source_name}</span>
                    {article.duplicate_of.published_at && (
                      <span className="text-orange-400">
                        {" "}· published {new Date(article.duplicate_of.published_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            )}
            <div className="flex flex-col sm:flex-row items-start justify-between gap-3 sm:gap-4">
              <div className="min-w-0">
                <p className="text-xs text-amber-500 mb-1">
                  {article.source_name}
                  {article.source_language && (
                    <span className="ml-2 inline-block bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded uppercase text-[10px] tracking-wide">
                      {article.source_language}
                    </span>
                  )}
                </p>
                <a href={article.url} target="_blank" rel="noopener noreferrer"
                  className="font-medium text-amber-900 hover:text-amber-600 transition-colors text-sm leading-snug">
                  {article.title}
                </a>
                {article.content && (
                  <p className="text-xs text-amber-600 mt-2 line-clamp-3">{article.content}</p>
                )}
                {(article.preview_title_en || article.preview_snippet_en) && (
                  <div className="mt-2 border-l-2 border-blue-200 pl-2">
                    <p className="text-[10px] text-blue-500 uppercase tracking-wide font-semibold">English preview</p>
                    {article.preview_title_en && (
                      <p className="text-xs text-blue-800 font-medium mt-0.5">{article.preview_title_en}</p>
                    )}
                    {article.preview_snippet_en && (
                      <p className="text-xs text-blue-700 mt-0.5">{article.preview_snippet_en}</p>
                    )}
                  </div>
                )}
                <p className="text-xs text-amber-400 mt-2">
                  {new Date(article.fetched_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </p>
              </div>
              <div className="flex gap-2 sm:shrink-0 flex-wrap">
                <button onClick={() => updateStatus(article.id, "approved")}
                  className="bg-green-100 hover:bg-green-200 text-green-700 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                  ✓ Approve
                </button>
                <button onClick={() => updateStatus(article.id, "discarded")}
                  className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${article.duplicate_of ? "bg-orange-200 hover:bg-orange-300 text-orange-800" : "bg-gray-100 hover:bg-gray-200 text-gray-500"}`}>
                  ✕ Discard
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
