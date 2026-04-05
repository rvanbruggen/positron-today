"use client";

import { useEffect, useState } from "react";

type RawArticle = {
  id: number;
  source_name: string;
  url: string;
  title: string;
  content: string;
  fetched_at: string;
  status: string;
};

export default function PreviewPage() {
  const [articles, setArticles] = useState<RawArticle[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchResult, setFetchResult] = useState<{ added: number; filtered: number; skipped: number } | null>(null);
  const [manualUrl, setManualUrl] = useState("");
  const [manualLoading, setManualLoading] = useState(false);
  const [manualResult, setManualResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function load() {
    const res = await fetch("/api/articles?status=pending");
    setArticles(await res.json());
  }

  useEffect(() => { load(); }, []);

  async function fetchNew() {
    setFetching(true);
    setFetchResult(null);
    const res = await fetch("/api/fetch", { method: "POST" });
    const data = await res.json();
    setFetchResult(data);
    setFetching(false);
    load();
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
    setArticles((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-amber-900">Preview</h1>
        <button
          onClick={fetchNew}
          disabled={fetching}
          className="bg-yellow-400 hover:bg-yellow-500 text-amber-900 font-medium px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
        >
          {fetching ? "Fetching..." : "Fetch new articles"}
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
          onChange={(e) => { setManualUrl(e.target.value); setManualResult(null); }}
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

      {fetchResult && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 text-sm text-green-700 mb-6">
          {fetchResult.added} positive article{fetchResult.added !== 1 ? "s" : ""} found
          {fetchResult.filtered > 0 && ` · ${fetchResult.filtered} filtered out as not a fit`}
          {fetchResult.skipped > 0 && ` · ${fetchResult.skipped} already known`}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {articles.length === 0 && (
          <p className="text-amber-600 text-sm">
            No pending articles. Hit "Fetch new articles" to pull from your sources, or paste a URL above.
          </p>
        )}
        {articles.map((article) => (
          <div
            key={article.id}
            className="bg-white rounded-xl p-5 shadow-sm border border-yellow-200"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs text-amber-500 mb-1">{article.source_name}</p>
                <a
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-amber-900 hover:text-amber-600 transition-colors text-sm leading-snug"
                >
                  {article.title}
                </a>
                {article.content && (
                  <p className="text-xs text-amber-600 mt-2 line-clamp-3">{article.content}</p>
                )}
                <p className="text-xs text-amber-400 mt-2">
                  {new Date(article.fetched_at).toLocaleDateString("en-GB", {
                    day: "numeric", month: "short", year: "numeric",
                  })}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => updateStatus(article.id, "approved")}
                  className="bg-green-100 hover:bg-green-200 text-green-700 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                >
                  ✓ Approve
                </button>
                <button
                  onClick={() => updateStatus(article.id, "discarded")}
                  className="bg-gray-100 hover:bg-gray-200 text-gray-500 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                >
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
