"use client";

import { useEffect, useState, useRef } from "react";
import { REJECTION_CATEGORIES, CATEGORY_MAP } from "@/lib/rejection-categories";

type Rejection = {
  id: number;
  source_name: string;
  url: string;
  title: string;
  snippet: string | null;
  rejection_reason: string | null;
  rejection_category: string | null;
  fetched_at: string;
};

type BackfillEvent =
  | { type: "start"; total: number }
  | { type: "progress"; id: number; title: string; category: string; reason: string; processed: number; total: number }
  | { type: "item_error"; id: number; title: string; message: string }
  | { type: "done"; processed: number; errors: number; total: number }
  | { type: "exporting" }
  | { type: "exported"; count: number }
  | { type: "export_error"; message: string }
  | { type: "fatal"; message: string };

function CategoryBadge({ slug }: { slug: string | null }) {
  if (!slug) return <span className="text-xs text-amber-300 italic">uncategorised</span>;
  const cat = CATEGORY_MAP.get(slug);
  if (!cat) return <span className="text-xs text-amber-300 italic">{slug}</span>;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${cat.color}`}>
      {cat.emoji} {cat.label}
    </span>
  );
}

export default function RejectionsPage() {
  const [items, setItems] = useState<Rejection[]>([]);
  const [filter, setFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  // Backfill state
  const [backfilling, setBackfilling] = useState(false);
  const [backfillLog, setBackfillLog] = useState<string[]>([]);
  const [backfillDone, setBackfillDone] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<{ processed: number; total: number } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  async function load() {
    const res = await fetch("/api/rejected");
    setItems(await res.json());
  }
  useEffect(() => { load(); }, []);

  // Auto-scroll backfill log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [backfillLog]);

  async function approve(id: number) {
    const res = await fetch("/api/rejected", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      setItems(prev => prev.filter(i => i.id !== id));
    } else {
      const data = await res.json();
      alert(data.error ?? "Could not approve");
    }
  }

  async function remove(id: number) {
    await fetch(`/api/rejected?id=${id}`, { method: "DELETE" });
    setItems(prev => prev.filter(i => i.id !== id));
  }

  async function exportToSite() {
    setExporting(true);
    setExportMsg(null);
    const res = await fetch("/api/export-rejections", { method: "POST" });
    const data = await res.json();
    setExporting(false);
    setExportMsg(res.ok ? `✓ Exported ${data.exported} articles to the public site` : `Error: ${data.error}`);
  }

  async function startBackfill() {
    setBackfilling(true);
    setBackfillDone(false);
    setBackfillLog(["Starting backfill…"]);
    setBackfillProgress(null);

    const res = await fetch("/api/backfill-categories", { method: "POST" });
    if (!res.body) { setBackfilling(false); return; }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line) as BackfillEvent;
          if (ev.type === "start") {
            setBackfillLog(prev => [...prev, `Found ${ev.total} articles to categorise.`]);
          } else if (ev.type === "progress") {
            setBackfillProgress({ processed: ev.processed, total: ev.total });
            const cat = CATEGORY_MAP.get(ev.category);
            setBackfillLog(prev => [...prev, `[${ev.processed}/${ev.total}] ${cat?.emoji ?? "?"} ${cat?.label ?? ev.category} — ${ev.title.slice(0, 60)}`]);
            // Update item in local state
            setItems(prev => prev.map(i => i.id === ev.id ? { ...i, rejection_category: ev.category, rejection_reason: ev.reason } : i));
          } else if (ev.type === "item_error") {
            setBackfillLog(prev => [...prev, `⚠ Error on "${ev.title.slice(0, 40)}": ${ev.message}`]);
          } else if (ev.type === "done") {
            setBackfillLog(prev => [...prev, `✓ Done — ${ev.processed} categorised, ${ev.errors ?? 0} errors.`]);
            setBackfillDone(true);
          } else if (ev.type === "exporting") {
            setBackfillLog(prev => [...prev, "Exporting to public site…"]);
          } else if (ev.type === "exported") {
            setBackfillLog(prev => [...prev, `✓ Exported ${ev.count} articles.`]);
          } else if (ev.type === "export_error") {
            setBackfillLog(prev => [...prev, `⚠ Export error: ${ev.message}`]);
          } else if (ev.type === "fatal") {
            setBackfillLog(prev => [...prev, `✗ Fatal: ${ev.message}`]);
            setBackfillDone(true);
          }
        } catch { /* malformed line */ }
      }
    }
    setBackfilling(false);
  }

  // Stats
  const bySrc: Record<string, number> = {};
  items.forEach(i => { bySrc[i.source_name] = (bySrc[i.source_name] ?? 0) + 1; });
  const topSources = Object.entries(bySrc).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const byCat: Record<string, number> = {};
  items.forEach(i => { const k = i.rejection_category ?? "uncategorised"; byCat[k] = (byCat[k] ?? 0) + 1; });

  const uncategorisedCount = items.filter(i => !i.rejection_category).length;

  const shown = items.filter(i => {
    if (categoryFilter !== "all" && (i.rejection_category ?? "") !== categoryFilter) return false;
    if (!filter) return true;
    return (
      i.title.toLowerCase().includes(filter.toLowerCase()) ||
      i.source_name.toLowerCase().includes(filter.toLowerCase()) ||
      (i.rejection_reason ?? "").toLowerCase().includes(filter.toLowerCase())
    );
  });

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-1">
        <h1 className="text-2xl font-bold text-amber-900">Rejection Log</h1>
        <div className="flex flex-col items-end gap-1">
          <button onClick={exportToSite} disabled={exporting || items.length === 0}
            className="bg-amber-900 hover:bg-amber-800 text-yellow-300 font-medium px-4 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-50">
            {exporting ? "Exporting..." : "Export to public site →"}
          </button>
          {exportMsg && <p className="text-xs text-amber-600">{exportMsg}</p>}
        </div>
      </div>
      <p className="text-amber-700 text-sm mb-6">
        Articles filtered out by the AI positivity check. Override to send to the review queue.
      </p>

      {/* Stats */}
      {items.length > 0 && (
        <div className="flex gap-4 mb-6 flex-wrap items-start">
          {/* Total */}
          <div className="bg-white rounded-xl p-4 border border-yellow-200 text-center min-w-[110px]">
            <p className="text-3xl font-bold text-amber-900">{items.length}</p>
            <p className="text-xs text-amber-600 mt-0.5">articles rejected</p>
          </div>

          {/* Per-source */}
          <div className="bg-white rounded-xl p-4 border border-yellow-200 flex-1 min-w-[200px]">
            <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-3">Top sources</p>
            <div className="flex flex-col gap-1.5">
              {topSources.map(([src, count]) => {
                const pct = Math.round((count / items.length) * 100);
                return (
                  <div key={src} className="flex items-center gap-2">
                    <span className="text-xs text-amber-800 w-32 truncate shrink-0">{src}</span>
                    <div className="flex-1 h-2 bg-amber-100 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-400 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-amber-600 w-14 text-right shrink-0">{count} ({pct}%)</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Per-category */}
          {Object.keys(byCat).length > 0 && (
            <div className="bg-white rounded-xl p-4 border border-yellow-200 flex-1 min-w-[200px]">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-3">By category</p>
              <div className="flex flex-col gap-1.5">
                {REJECTION_CATEGORIES.filter(c => byCat[c.slug]).map(cat => {
                  const count = byCat[cat.slug] ?? 0;
                  const pct = Math.round((count / items.length) * 100);
                  return (
                    <div key={cat.slug} className="flex items-center gap-2">
                      <span className="text-xs w-36 truncate shrink-0">{cat.emoji} {cat.label}</span>
                      <div className="flex-1 h-2 bg-amber-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: cat.colorHex }} />
                      </div>
                      <span className="text-xs text-amber-600 w-14 text-right shrink-0">{count} ({pct}%)</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Backfill panel */}
      <div className="bg-white rounded-xl border border-yellow-200 p-4 mb-6">
        <div className="flex items-center justify-between gap-4 mb-2">
          <div>
            <p className="text-sm font-semibold text-amber-900">Backfill categories</p>
            <p className="text-xs text-amber-600 mt-0.5">
              {uncategorisedCount > 0
                ? `${uncategorisedCount} article${uncategorisedCount !== 1 ? "s" : ""} still need a category. Uses the configured filter provider (Ollama recommended).`
                : "All articles have been categorised. ✓"}
            </p>
          </div>
          <button onClick={startBackfill}
            disabled={backfilling || uncategorisedCount === 0}
            className="bg-amber-100 hover:bg-amber-200 text-amber-900 font-medium px-4 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-50 whitespace-nowrap shrink-0">
            {backfilling ? "Running…" : "Backfill now"}
          </button>
        </div>

        {backfillLog.length > 0 && (
          <>
            {backfillProgress && !backfillDone && (
              <div className="w-full h-1.5 bg-amber-100 rounded-full overflow-hidden mb-2">
                <div className="h-full bg-amber-400 rounded-full transition-all duration-300"
                  style={{ width: `${Math.round((backfillProgress.processed / backfillProgress.total) * 100)}%` }} />
              </div>
            )}
            <div ref={logRef}
              className="bg-amber-950 rounded-lg p-3 text-xs font-mono text-amber-200 max-h-40 overflow-y-auto leading-relaxed">
              {backfillLog.map((line, i) => <div key={i}>{line}</div>)}
            </div>
          </>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <input
          className="border border-yellow-200 rounded-lg px-3 py-2 text-sm flex-1 min-w-[200px] focus:outline-none focus:border-yellow-400"
          placeholder="Filter by title, source, or reason…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
          className="border border-yellow-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-yellow-400">
          <option value="all">All categories</option>
          {REJECTION_CATEGORIES.map(c => (
            <option key={c.slug} value={c.slug}>{c.emoji} {c.label}</option>
          ))}
        </select>
      </div>

      {/* List */}
      {shown.length === 0 ? (
        <p className="text-amber-600 text-sm">
          {items.length === 0 ? "No rejections yet — fetch some articles first." : "No matches."}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map(item => (
            <div key={item.id} className="bg-white rounded-xl px-5 py-3 shadow-sm border border-yellow-200">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <a href={item.url} target="_blank" rel="noopener noreferrer"
                    className="font-medium text-amber-900 text-sm hover:text-amber-600 transition-colors leading-snug block">
                    {item.title}
                  </a>
                  <div className="flex gap-3 mt-1 flex-wrap items-center">
                    <span className="text-xs text-amber-500">{item.source_name}</span>
                    <span className="text-xs text-amber-400">{item.fetched_at.slice(0, 10)}</span>
                    <CategoryBadge slug={item.rejection_category} />
                  </div>
                  {item.rejection_reason && (
                    <p className="text-xs text-red-500 mt-1.5 italic leading-relaxed">
                      ✗ {item.rejection_reason}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => approve(item.id)}
                    className="text-xs bg-yellow-100 hover:bg-yellow-200 text-amber-800 font-medium px-3 py-1 rounded-lg transition-colors">
                    Override ↑
                  </button>
                  <button onClick={() => remove(item.id)}
                    className="text-xs text-red-400 hover:text-red-600 transition-colors">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
