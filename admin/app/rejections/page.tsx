"use client";

import { useEffect, useState } from "react";

type Rejection = {
  id: number;
  source_name: string;
  url: string;
  title: string;
  snippet: string | null;
  rejection_reason: string | null;
  fetched_at: string;
};

export default function RejectionsPage() {
  const [items, setItems] = useState<Rejection[]>([]);
  const [filter, setFilter] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/rejected");
    setItems(await res.json());
  }
  useEffect(() => { load(); }, []);

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

  const shown = filter
    ? items.filter(i =>
        i.title.toLowerCase().includes(filter.toLowerCase()) ||
        i.source_name.toLowerCase().includes(filter.toLowerCase()) ||
        (i.rejection_reason ?? "").toLowerCase().includes(filter.toLowerCase())
      )
    : items;

  // Stats
  const bySrc: Record<string, number> = {};
  items.forEach(i => { bySrc[i.source_name] = (bySrc[i.source_name] ?? 0) + 1; });
  const topSources = Object.entries(bySrc).sort((a, b) => b[1] - a[1]).slice(0, 5);

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-1">
        <h1 className="text-2xl font-bold text-amber-900">Rejection Log</h1>
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={exportToSite}
            disabled={exporting || items.length === 0}
            className="bg-amber-900 hover:bg-amber-800 text-yellow-300 font-medium px-4 py-1.5 rounded-lg text-sm transition-colors disabled:opacity-50"
          >
            {exporting ? "Exporting..." : "Export to public site →"}
          </button>
          {exportMsg && <p className="text-xs text-amber-600">{exportMsg}</p>}
        </div>
      </div>
      <p className="text-amber-700 text-sm mb-6">
        Articles filtered out by the AI positivity check. You can override and send any of them to the review queue.
      </p>

      {/* Stats */}
      {items.length > 0 && (
        <div className="flex gap-4 mb-6 flex-wrap items-start">
          {/* Total */}
          <div className="bg-white rounded-xl p-4 border border-yellow-200 text-center min-w-[110px]">
            <p className="text-3xl font-bold text-amber-900">{items.length}</p>
            <p className="text-xs text-amber-600 mt-0.5">articles rejected<br/>in total</p>
          </div>

          {/* Per-source breakdown */}
          <div className="bg-white rounded-xl p-4 border border-yellow-200 flex-1 min-w-[220px]">
            <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-3">
              Rejections per source
            </p>
            <div className="flex flex-col gap-1.5">
              {topSources.map(([src, count]) => {
                const pct = Math.round((count / items.length) * 100);
                return (
                  <div key={src} className="flex items-center gap-2">
                    <span className="text-xs text-amber-800 w-36 truncate shrink-0">{src}</span>
                    <div className="flex-1 h-2 bg-amber-100 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-400 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-amber-600 w-14 text-right shrink-0">
                      {count} ({pct}%)
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Filter */}
      <input
        className="border border-yellow-200 rounded-lg px-3 py-2 text-sm w-full mb-4 focus:outline-none focus:border-yellow-400"
        placeholder="Filter by title, source, or reason…"
        value={filter}
        onChange={e => setFilter(e.target.value)}
      />

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
                  <div className="flex gap-3 mt-0.5 flex-wrap">
                    <span className="text-xs text-amber-500">{item.source_name}</span>
                    <span className="text-xs text-amber-400">{item.fetched_at.slice(0, 10)}</span>
                  </div>
                  {item.rejection_reason && (
                    <p className="text-xs text-red-500 mt-1 italic">
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
