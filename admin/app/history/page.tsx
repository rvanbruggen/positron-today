export const dynamic = "force-dynamic";

import db from "@/lib/db";

export default async function HistoryPage() {
  const result = await db.execute(`
    SELECT a.*, t.name as topic_name, t.emoji as topic_emoji
    FROM articles a
    LEFT JOIN topics t ON a.topic_id = t.id
    WHERE a.status = 'published'
    ORDER BY a.published_at DESC
    LIMIT 100
  `);
  const articles = result.rows;

  return (
    <div>
      <h1 className="text-2xl font-bold text-amber-900 mb-1">History</h1>
      <p className="text-amber-700 text-sm mb-8">
        All published articles, most recent first.
      </p>

      {articles.length === 0 ? (
        <p className="text-amber-600 text-sm">Nothing published yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {articles.map((a) => (
            <div key={String(a.id)} className="bg-white rounded-xl px-5 py-4 shadow-sm border border-yellow-200 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-xl">{String(a.topic_emoji ?? "📰")}</span>
                <div className="min-w-0">
                  <p className="font-medium text-amber-900 text-sm truncate">
                    {String(a.title_en ?? a.title_nl ?? a.source_url)}
                  </p>
                  <p className="text-xs text-amber-500">{String(a.source_name)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <a
                  href={String(a.source_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-amber-500 hover:text-amber-700 transition-colors"
                >
                  Source ↗
                </a>
                <span className="text-xs text-amber-500">
                  {a.published_at ? new Date(String(a.published_at)).toLocaleDateString("en-GB", {
                    day: "numeric", month: "short", year: "numeric",
                  }) : ""}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
