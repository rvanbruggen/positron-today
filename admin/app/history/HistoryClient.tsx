"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import EditArticleModal, { type EditableFields } from "@/app/components/EditArticleModal";

type ArticleTag = { id: number; name: string; emoji: string };

type Article = {
  id: number;
  title_en: string | null;
  title_nl: string | null;
  title_fr: string | null;
  summary_en: string | null;
  summary_nl: string | null;
  summary_fr: string | null;
  source_url: string;
  source_name: string;
  article_emoji: string | null;
  tags: ArticleTag[];
  published_at: string | null;
  publish_date: string | null;
  published_path: string | null;
  source_pub_date: string | null;
  image_url: string | null;
  social_posted_at: string | null;
  featured: boolean;
  positivity_score: number | null;
};

const SITE_BASE = "https://positron.today";

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").slice(0, 60).replace(/-$/, "");
}

function livePostUrl(a: Article): string {
  // Prefer the stored published_path over reconstructing from slug
  if (a.published_path) {
    // published_path is e.g. "site/src/posts/2026-04-06-some-title.md"
    const filename = a.published_path.split("/").pop()?.replace(/\.md$/, "");
    if (filename) return `${SITE_BASE}/posts/${filename}/`;
  }
  const date = (a.publish_date ?? a.published_at ?? "").slice(0, 10);
  const title = a.title_en ?? a.title_nl ?? "";
  if (!date || !title) return "";
  return `${SITE_BASE}/posts/${date}-${slugify(title)}/`;
}

function articleMonth(a: Article): string {
  return (a.published_at ?? a.publish_date ?? "").slice(0, 7);
}

function formatMonth(ym: string): string {
  if (!ym) return "";
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

function formatDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

type SortKey = "title" | "source" | "date";
type SortDir = "asc" | "desc";

export default function HistoryClient({
  initialArticles,
  allTags,
}: {
  initialArticles: Article[];
  allTags: ArticleTag[];
}) {
  const [articles, setArticles]           = useState<Article[]>(initialArticles);
  const [resetting, setResetting]         = useState<Set<number>>(new Set());
  const [republishing, setRepublishing]   = useState<Set<number>>(new Set());
  const [republished, setRepublished]     = useState<Set<number>>(new Set());
  const [removing, setRemoving]           = useState<Set<number>>(new Set());
  const [generatingCard, setGeneratingCard]   = useState<Set<number>>(new Set());
  const [postingBluesky, setPostingBluesky]   = useState<Set<number>>(new Set());
  const [postedBluesky,  setPostedBluesky]    = useState<Set<number>>(new Set());
  const [twitterOpened,  setTwitterOpened]    = useState<Set<number>>(new Set());
  const [postingSocial,  setPostingSocial]    = useState<Set<number>>(new Set());
  const [postedSocial,   setPostedSocial]     = useState<Set<number>>(
    () => new Set(initialArticles.filter((a) => a.social_posted_at).map((a) => a.id))
  );
  const [socialMenuOpen, setSocialMenuOpen]   = useState<number | null>(null);
  const [filterTag, setFilterTag]         = useState("all");
  const [filterMonth, setFilterMonth]     = useState("all");
  const [sortKey, setSortKey]             = useState<SortKey>("date");
  const [sortDir, setSortDir]             = useState<SortDir>("desc");
  const [error, setError]                 = useState<string | null>(null);
  const [editingId, setEditingId]         = useState<number | null>(null);

  // Close social dropdown when clicking outside
  const closeSocialMenu = useCallback(() => setSocialMenuOpen(null), []);
  useEffect(() => {
    if (socialMenuOpen !== null) {
      document.addEventListener("click", closeSocialMenu);
      return () => document.removeEventListener("click", closeSocialMenu);
    }
  }, [socialMenuOpen, closeSocialMenu]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <span className="ml-1 opacity-30">↕</span>;
    return <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  const availableTags = useMemo(
    () => [...new Set(articles.flatMap((a) => a.tags.map((t) => t.name)))].sort(),
    [articles]
  );

  const availableMonths = useMemo(
    () => [...new Set(articles.map(articleMonth).filter(Boolean))].sort().reverse(),
    [articles]
  );

  const displayed = useMemo(() => {
    const filtered = articles.filter((a) => {
      if (filterTag !== "all" && !a.tags.some((t) => t.name === filterTag)) return false;
      if (filterMonth !== "all" && articleMonth(a) !== filterMonth) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "title") {
        cmp = (a.title_en ?? a.title_nl ?? "").localeCompare(b.title_en ?? b.title_nl ?? "");
      } else if (sortKey === "source") {
        cmp = a.source_name.localeCompare(b.source_name);
      } else {
        // date — compare ISO strings directly
        cmp = (a.published_at ?? "").localeCompare(b.published_at ?? "");
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [articles, filterTag, filterMonth, sortKey, sortDir]);

  async function republish(id: number) {
    setRepublishing((prev) => new Set(prev).add(id));
    setError(null);
    try {
      const res = await fetch("/api/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? `Republish failed: ${res.status}`); return; }
      setRepublished((prev) => new Set(prev).add(id));
      setTimeout(() => setRepublished((prev) => { const s = new Set(prev); s.delete(id); return s; }), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setRepublishing((prev) => { const s = new Set(prev); s.delete(id); return s; });
    }
  }

  async function resummarise(id: number) {
    setResetting((prev) => new Set(prev).add(id));
    try {
      await fetch("/api/articles", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, reset_to_draft: true }),
      });
      setArticles((prev) => prev.filter((a) => a.id !== id));
    } finally {
      setResetting((prev) => { const s = new Set(prev); s.delete(id); return s; });
    }
  }

  async function removeFromSite(article: Article) {
    if (!confirm(`Remove "${article.title_en ?? article.title_nl ?? "this article"}" from the live site?`)) return;
    setRemoving((prev) => new Set(prev).add(article.id));
    setError(null);
    try {
      const params = new URLSearchParams({ id: String(article.id) });
      if (article.published_path) params.set("published_path", article.published_path);
      const res = await fetch(`/api/articles?${params}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Removal failed"); return; }
      setArticles((prev) => prev.filter((a) => a.id !== article.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setRemoving((prev) => { const s = new Set(prev); s.delete(article.id); return s; });
    }
  }

  async function generateInstagramCard(a: Article) {
    setGeneratingCard((prev) => new Set(prev).add(a.id));
    setError(null);
    try {
      const res = await fetch(`/api/instagram-card?id=${a.id}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Card generation failed: ${res.status}`);
        return;
      }
      // Trigger browser download
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a_el = document.createElement("a");
      a_el.href  = url;
      const slug = (a.title_en ?? a.title_nl ?? "article").toLowerCase().replace(/[^\w]+/g, "-").slice(0, 50);
      a_el.download = `positron-${slug}.png`;
      a_el.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setGeneratingCard((prev) => { const s = new Set(prev); s.delete(a.id); return s; });
    }
  }

  function openTwitterIntent(a: Article) {
    // Prevent double-firing (double-click, etc.)
    if (twitterOpened.has(a.id)) return;
    setTwitterOpened((prev) => new Set(prev).add(a.id));
    setTimeout(() => setTwitterOpened((prev) => { const s = new Set(prev); s.delete(a.id); return s; }), 4000);

    const SITE_BASE = "https://positron.today";
    const slug = a.published_path
      ? a.published_path.split("/").pop()?.replace(/\.md$/, "")
      : null;
    const url = slug ? `${SITE_BASE}/posts/${slug}/` : SITE_BASE;

    // Build tweet text within 280 chars (URL counts as 23 via t.co)
    const emoji   = a.article_emoji ?? "✨";
    const title   = a.title_en ?? a.title_nl ?? "";
    const summary = a.summary_en ?? "";
    const prefix  = `${emoji} ${title}\n\n`;
    const suffix  = `\n\n${url}`;
    const budget  = 280 - 23 - 2 - prefix.length; // 23=t.co, 2=\n\n before url
    const snippet = budget > 0
      ? summary.length > budget ? summary.slice(0, budget - 1) + "…" : summary
      : "";
    const text = `${prefix}${snippet}${suffix}`;

    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`,
      "_blank"
    );
  }

  async function postToSocials(a: Article, platforms?: string[]) {
    setSocialMenuOpen(null);
    setPostingSocial((prev) => new Set(prev).add(a.id));
    setError(null);
    try {
      const body: Record<string, unknown> = { id: a.id };
      if (platforms) body.platforms = platforms;
      const res  = await fetch("/api/post-social", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? `Social post failed: ${res.status}`); return; }
      if (data.warning) setError(`Posted, but: ${data.warning}`);
      setPostedSocial((prev) => new Set(prev).add(a.id));
      setArticles((prev) => prev.map((x) =>
        x.id === a.id ? { ...x, social_posted_at: new Date().toISOString() } : x
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setPostingSocial((prev) => { const s = new Set(prev); s.delete(a.id); return s; });
    }
  }

  async function postToBluesky(a: Article) {
    setPostingBluesky((prev) => new Set(prev).add(a.id));
    setError(null);
    try {
      const res  = await fetch("/api/post-bluesky", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ id: a.id }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? `Bluesky post failed: ${res.status}`); return; }
      setPostedBluesky((prev) => new Set(prev).add(a.id));
      setTimeout(() => setPostedBluesky((prev) => { const s = new Set(prev); s.delete(a.id); return s; }), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setPostingBluesky((prev) => { const s = new Set(prev); s.delete(a.id); return s; });
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-amber-900">History</h1>
        <span className="text-sm text-amber-500">{displayed.length} of {articles.length} articles</span>
      </div>
      <p className="text-amber-700 text-sm mb-6">
        All published articles. Re-summarise moves the article back to the Preview queue. Remove deletes it from the live site.
      </p>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700 mb-4">{error}</div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl px-5 py-3 shadow-sm border border-yellow-200 mb-5 flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Tag</label>
          <select value={filterTag} onChange={(e) => setFilterTag(e.target.value)}
            className="border border-yellow-200 rounded-lg px-3 py-1.5 text-sm text-amber-900 focus:outline-none focus:border-yellow-400 bg-white">
            <option value="all">All tags</option>
            {availableTags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Month</label>
          <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}
            className="border border-yellow-200 rounded-lg px-3 py-1.5 text-sm text-amber-900 focus:outline-none focus:border-yellow-400 bg-white">
            <option value="all">All months</option>
            {availableMonths.map((m) => <option key={m} value={m}>{formatMonth(m)}</option>)}
          </select>
        </div>
        {(filterTag !== "all" || filterMonth !== "all") && (
          <button onClick={() => { setFilterTag("all"); setFilterMonth("all"); }}
            className="text-xs text-amber-500 hover:text-amber-700 transition-colors">
            Clear ✕
          </button>
        )}
      </div>

      {displayed.length === 0 ? (
        <p className="text-amber-600 text-sm">{articles.length === 0 ? "Nothing published yet." : "No articles match these filters."}</p>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-yellow-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-yellow-100 bg-amber-50">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-amber-700 uppercase tracking-wide">
                  <button onClick={() => handleSort("title")} className="flex items-center hover:text-amber-900 transition-colors">
                    Title<SortIcon col="title" />
                  </button>
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-amber-700 uppercase tracking-wide hidden md:table-cell">
                  <button onClick={() => handleSort("source")} className="flex items-center hover:text-amber-900 transition-colors">
                    Source<SortIcon col="source" />
                  </button>
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-amber-700 uppercase tracking-wide hidden lg:table-cell">Tags</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-amber-700 uppercase tracking-wide whitespace-nowrap">
                  <button onClick={() => handleSort("date")} className="flex items-center hover:text-amber-900 transition-colors">
                    Date<SortIcon col="date" />
                  </button>
                </th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-amber-700 uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((a, i) => {
                const postUrl = livePostUrl(a);
                const title = a.title_en ?? a.title_nl ?? a.source_url;
                const isLast = i === displayed.length - 1;
                return (
                  <tr key={a.id} className={`${!isLast ? "border-b border-yellow-50" : ""} hover:bg-amber-50/40 transition-colors`}>

                    {/* Title */}
                    <td className="px-4 py-2.5 max-w-xs">
                      <div className="flex items-start gap-1.5">
                        <span className="shrink-0 text-base leading-5">{a.article_emoji ?? "📰"}</span>
                        <div className="min-w-0">
                          {postUrl ? (
                            <a href={postUrl} target="_blank" rel="noopener noreferrer"
                              className="font-medium text-amber-900 hover:text-amber-600 transition-colors line-clamp-2 leading-snug">
                              {title}
                            </a>
                          ) : (
                            <span className="font-medium text-amber-900 line-clamp-2 leading-snug">{title}</span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Source */}
                    <td className="px-4 py-2.5 hidden md:table-cell">
                      <a href={a.source_url} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-amber-500 hover:text-amber-700 transition-colors whitespace-nowrap">
                        {a.source_name}
                      </a>
                      {a.positivity_score != null && (
                        <span
                          className={`ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            a.positivity_score >= 8
                              ? "bg-green-100 text-green-700"
                              : a.positivity_score >= 6
                              ? "bg-yellow-100 text-yellow-700"
                              : "bg-orange-100 text-orange-700"
                          }`}
                          title={`Positivity score: ${a.positivity_score}/10`}
                        >
                          ☀️ {a.positivity_score}/10
                        </span>
                      )}
                    </td>

                    {/* Tags */}
                    <td className="px-4 py-2.5 hidden lg:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {a.tags.length > 0
                          ? a.tags.map((t) => (
                              <span key={t.id} className="text-xs bg-yellow-100 text-amber-800 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                                {t.emoji} {t.name}
                              </span>
                            ))
                          : <span className="text-xs text-amber-300">—</span>
                        }
                      </div>
                    </td>

                    {/* Date */}
                    <td className="px-4 py-2.5 text-xs text-amber-500 whitespace-nowrap">
                      {a.source_pub_date ? (
                        <div>
                          <div title="Original source date">{formatDate(a.source_pub_date)}</div>
                          <div className="text-amber-300 text-[10px]" title="Date published to site">published {formatDate(a.published_at ?? a.publish_date)}</div>
                        </div>
                      ) : (
                        formatDate(a.published_at ?? a.publish_date)
                      )}
                    </td>

                    {/* Actions — icon-only compact buttons, tooltips on hover */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1 justify-end">

                        {/* Instagram card */}
                        <button
                          onClick={() => generateInstagramCard(a)}
                          disabled={generatingCard.has(a.id)}
                          title="Generate Instagram card"
                          className="w-7 h-7 flex items-center justify-center rounded bg-pink-100 hover:bg-pink-200 text-pink-700 transition-colors disabled:opacity-40 text-sm">
                          {generatingCard.has(a.id) ? "⏳" : "📸"}
                        </button>

                        {/* Post to socials via Post for Me — dropdown */}
                        <div className="relative">
                          <button
                            onClick={(e) => { e.stopPropagation(); setSocialMenuOpen(socialMenuOpen === a.id ? null : a.id); }}
                            disabled={postingSocial.has(a.id)}
                            title={
                              a.social_posted_at
                                ? `Posted on ${formatDate(a.social_posted_at)} — click to repost`
                                : "Post to social media"
                            }
                            className={`w-7 h-7 flex items-center justify-center rounded text-sm transition-colors ${
                              postingSocial.has(a.id)
                                ? "bg-violet-200 text-violet-700"
                                : postedSocial.has(a.id)
                                ? "bg-violet-200 hover:bg-violet-300 text-violet-700"
                                : "bg-violet-100 hover:bg-violet-200 text-violet-700"
                            }`}>
                            {postingSocial.has(a.id) ? "⏳" : postedSocial.has(a.id) ? "📣✓" : "📣"}
                          </button>
                          {socialMenuOpen === a.id && (
                            <div className="absolute right-0 top-8 z-50 bg-white border border-violet-200 rounded-lg shadow-lg py-1 min-w-[160px]">
                              <button onClick={() => postToSocials(a)}
                                className="w-full text-left px-3 py-1.5 text-sm text-violet-800 hover:bg-violet-50">
                                📣 All platforms
                              </button>
                              <hr className="border-violet-100 my-1" />
                              <button onClick={() => postToSocials(a, ["instagram"])}
                                className="w-full text-left px-3 py-1.5 text-sm text-violet-800 hover:bg-violet-50">
                                📷 Instagram only
                              </button>
                              <button onClick={() => postToSocials(a, ["bluesky"])}
                                className="w-full text-left px-3 py-1.5 text-sm text-violet-800 hover:bg-violet-50">
                                🦋 Bluesky only
                              </button>
                              <button onClick={() => postToSocials(a, ["x"])}
                                className="w-full text-left px-3 py-1.5 text-sm text-violet-800 hover:bg-violet-50">
                                𝕏 X only
                              </button>
                              <button onClick={() => postToSocials(a, ["threads"])}
                                className="w-full text-left px-3 py-1.5 text-sm text-violet-800 hover:bg-violet-50">
                                🧵 Threads only
                              </button>
                              <button onClick={() => postToSocials(a, ["facebook"])}
                                className="w-full text-left px-3 py-1.5 text-sm text-violet-800 hover:bg-violet-50">
                                👤 Facebook only
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Edit */}
                        <button
                          onClick={() => setEditingId(a.id)}
                          title="Edit article"
                          className="w-7 h-7 flex items-center justify-center rounded bg-amber-100 hover:bg-amber-200 text-amber-700 transition-colors text-sm">
                          ✏️
                        </button>

                        {/* Republish */}
                        <button
                          onClick={() => republish(a.id)}
                          disabled={republishing.has(a.id) || republished.has(a.id)}
                          title="Republish to site"
                          className="w-7 h-7 flex items-center justify-center rounded bg-green-100 hover:bg-green-200 text-green-700 transition-colors disabled:opacity-40 text-sm font-bold">
                          {republished.has(a.id) ? "✓" : republishing.has(a.id) ? "⏳" : (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                            </svg>
                          )}
                        </button>

                        {/* Re-summarise */}
                        <button
                          onClick={() => resummarise(a.id)}
                          disabled={resetting.has(a.id)}
                          title="Move back to Preview queue"
                          className="w-7 h-7 flex items-center justify-center rounded bg-blue-50 hover:bg-blue-100 text-blue-500 transition-colors disabled:opacity-40 text-sm font-bold">
                          {resetting.has(a.id) ? "⏳" : (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.85"/>
                            </svg>
                          )}
                        </button>

                        {/* Remove */}
                        <button
                          onClick={() => removeFromSite(a)}
                          disabled={removing.has(a.id)}
                          title="Remove from site"
                          className="w-7 h-7 flex items-center justify-center rounded bg-red-50 hover:bg-red-100 text-red-400 hover:text-red-600 transition-colors disabled:opacity-40 text-sm font-bold">
                          {removing.has(a.id) ? "⏳" : "✕"}
                        </button>

                      </div>
                    </td>

                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editingId !== null && (() => {
        const a = articles.find((x) => x.id === editingId);
        if (!a) return null;
        return (
          <EditArticleModal
            articleId={a.id}
            isPublished={true}
            initial={{
              title_en: a.title_en ?? "",
              title_nl: a.title_nl ?? "",
              title_fr: a.title_fr ?? "",
              summary_en: a.summary_en ?? "",
              summary_nl: a.summary_nl ?? "",
              summary_fr: a.summary_fr ?? "",
              article_emoji: a.article_emoji ?? "✨",
              featured: !!a.featured,
            }}
            onClose={() => setEditingId(null)}
            onSaved={(fields: EditableFields) => {
              setArticles((prev) => prev.map((x) =>
                x.id === editingId ? { ...x, ...fields } : x
              ));
              setRepublished((prev) => new Set(prev).add(editingId));
              setTimeout(() => setRepublished((prev) => { const s = new Set(prev); s.delete(editingId!); return s; }), 2500);
            }}
          />
        );
      })()}
    </div>
  );
}
