"use client";

import { useEffect, useRef, useState } from "react";

type RawArticle = {
  id: number;
  source_name: string;
  url: string;
  title: string;
  content: string;
  fetched_at: string;
  status: string;
};

type LogLine =
  | { type: "start"; totalSources: number }
  | { type: "source"; name: string; url: string }
  | { type: "article"; verdict: "added" | "filtered"; title: string; reason?: string }
  | { type: "source_done"; name: string; added: number; filtered: number; skipped: number }
  | { type: "source_error"; name: string; message: string }
  | { type: "exporting" }
  | { type: "exported"; count: number }
  | { type: "export_error"; message: string }
  | { type: "done"; added: number; filtered: number; skipped: number; hasMore?: boolean; nextOffset?: number }
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

  async function load() {
    const res = await fetch("/api/articles?status=pending");
    setArticles(await res.json());
  }
  useEffect(() => { load(); }, []);

  // Auto-scroll log to bottom as lines arrive
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  async function fetchNew() {
    setFetching(true);
    setLogs([]);
    setProgress(0);
    setTotalSources(0);
    setSourcesDone(0);

    const CHUNK = 10;
    let currentOffset = 0;
    let total = 0;
    let cumulativeDone = 0;

    try {
      while (true) {
        const res = await fetch(`/api/fetch?offset=${currentOffset}&limit=${CHUNK}`, { method: "POST" });
        if (!res.body) throw new Error("No response body");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let chunkHasMore = false;
        let nextOffset = currentOffset + CHUNK;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const event = JSON.parse(line) as LogLine;
              setLogs(prev => [...prev, event]);

              if (event.type === "start") {
                if (total === 0) {
                  total = event.totalSources;
                  setTotalSources(total);
                }
              }
              if (event.type === "source_done" || event.type === "source_error") {
                cumulativeDone++;
                setSourcesDone(cumulativeDone);
                setProgress(total > 0 ? Math.round((cumulativeDone / total) * 100) : 0);
              }
              if (event.type === "done") {
                chunkHasMore = !!event.hasMore;
                nextOffset = event.nextOffset ?? nextOffset;
                if (!chunkHasMore) {
                  setProgress(100);
                  load();
                }
              }
              if (event.type === "exported" || event.type === "export_error" || event.type === "fatal") {
                if (!chunkHasMore) setFetching(false);
              }
            } catch { /* malformed line */ }
          }
        }

        if (!chunkHasMore) break;
        currentOffset = nextOffset;
        setLogs(prev => [...prev, { type: "source" as const, name: `── Chunk ${Math.floor(currentOffset / CHUNK) + 1} ──`, url: "" }]);
      }
    } catch (err) {
      setLogs(prev => [...prev, { type: "fatal", message: String(err) }]);
    }
    setFetching(false);
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

  const isDone = logs.some(l => l.type === "exported" || l.type === "export_error" || l.type === "fatal");
  const doneEvent = logs.find((l): l is Extract<LogLine, { type: "done" }> => l.type === "done");

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-amber-900">Preview</h1>
        <button
          onClick={fetchNew}
          disabled={fetching}
          className="bg-yellow-400 hover:bg-yellow-500 text-amber-900 font-medium px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
        >
          {fetching ? "Fetching…" : "Fetch new articles"}
        </button>
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
                  ? totalSources === 0
                    ? "Starting…"
                    : sourcesDone < totalSources
                      ? `Scanning source ${sourcesDone + 1} of ${totalSources}…`
                      : "Finalising…"
                  : isDone ? "Fetch complete" : "Starting…"}
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
              if (line.type === "start")
                return <div key={i} className="text-amber-400 mt-1">Found {line.totalSources} sources to scan</div>;
              if (line.type === "source")
                return <div key={i} className="text-yellow-300 font-semibold mt-2">📡 {line.name}</div>;
              if (line.type === "article" && line.verdict === "added")
                return <div key={i} className="text-green-400 pl-3">✓ {line.title}</div>;
              if (line.type === "article" && line.verdict === "filtered")
                return <div key={i} className="text-red-400 pl-3">✗ {line.title}{line.reason ? <span className="text-red-600"> — {line.reason}</span> : null}</div>;
              if (line.type === "source_done")
                return <div key={i} className="text-amber-600 pl-3 pb-1">↳ +{line.added} added · {line.filtered} filtered · {line.skipped} already known</div>;
              if (line.type === "source_error")
                return <div key={i} className="text-orange-400 pl-3">⚠ {line.name}: {line.message}</div>;
              if (line.type === "done")
                return <div key={i} className="text-green-300 font-semibold mt-2">✅ Done — {line.added} added · {line.filtered} filtered · {line.skipped} already known</div>;
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

          {/* Summary bar when done */}
          {doneEvent && (
            <div className="border-t border-amber-800 px-4 py-2 flex gap-4 text-xs">
              <span className="text-green-400 font-semibold">+{doneEvent.added} new</span>
              <span className="text-red-400">{doneEvent.filtered} filtered</span>
              <span className="text-amber-600">{doneEvent.skipped} skipped</span>
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
          <div key={article.id} className="bg-white rounded-xl p-5 shadow-sm border border-yellow-200">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs text-amber-500 mb-1">{article.source_name}</p>
                <a href={article.url} target="_blank" rel="noopener noreferrer"
                  className="font-medium text-amber-900 hover:text-amber-600 transition-colors text-sm leading-snug">
                  {article.title}
                </a>
                {article.content && (
                  <p className="text-xs text-amber-600 mt-2 line-clamp-3">{article.content}</p>
                )}
                <p className="text-xs text-amber-400 mt-2">
                  {new Date(article.fetched_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => updateStatus(article.id, "approved")}
                  className="bg-green-100 hover:bg-green-200 text-green-700 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                  ✓ Approve
                </button>
                <button onClick={() => updateStatus(article.id, "discarded")}
                  className="bg-gray-100 hover:bg-gray-200 text-gray-500 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
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
