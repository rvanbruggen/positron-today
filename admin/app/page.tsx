export const dynamic = "force-dynamic";

import Link from "next/link";
import { initSchema } from "@/lib/schema";
import db from "@/lib/db";

export default async function DashboardPage() {
  await initSchema();

  const [sourcesResult, topicsResult, pendingResult, scheduledResult] =
    await Promise.all([
      db.execute("SELECT COUNT(*) as count FROM sources WHERE active = 1"),
      db.execute("SELECT COUNT(*) as count FROM topics"),
      db.execute("SELECT COUNT(*) as count FROM raw_articles WHERE status = 'pending'"),
      db.execute("SELECT COUNT(*) as count FROM articles WHERE status = 'scheduled'"),
    ]);

  const stats = {
    sources: Number(sourcesResult.rows[0].count),
    topics: Number(topicsResult.rows[0].count),
    pending: Number(pendingResult.rows[0].count),
    scheduled: Number(scheduledResult.rows[0].count),
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-amber-900 mb-1">Dashboard</h1>
      <p className="text-amber-700 text-sm mb-8">
        Good morning! Here&apos;s where things stand.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        {[
          { label: "Active sources", value: stats.sources, href: "/sources", emoji: "📡" },
          { label: "Topics", value: stats.topics, href: "/topics", emoji: "🏷️" },
          { label: "Pending review", value: stats.pending, href: "/preview", emoji: "📬" },
          { label: "Scheduled", value: stats.scheduled, href: "/scheduled", emoji: "📅" },
        ].map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="bg-white rounded-xl p-5 shadow-sm border border-yellow-200 hover:border-yellow-400 transition-colors"
          >
            <div className="text-2xl mb-1">{stat.emoji}</div>
            <div className="text-3xl font-bold text-amber-900">{stat.value}</div>
            <div className="text-sm text-amber-600 mt-1">{stat.label}</div>
          </Link>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-yellow-200">
          <h2 className="font-semibold text-amber-900 mb-3">Quick actions</h2>
          <div className="flex flex-col gap-2">
            <Link href="/preview" className="text-sm text-amber-700 hover:text-amber-900">
              → Fetch &amp; review new articles
            </Link>
            <Link href="/sources" className="text-sm text-amber-700 hover:text-amber-900">
              → Add a new source
            </Link>
            <Link href="/scheduled" className="text-sm text-amber-700 hover:text-amber-900">
              → View upcoming publications
            </Link>
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm border border-yellow-200">
          <h2 className="font-semibold text-amber-900 mb-3">About this system</h2>
          <p className="text-sm text-amber-700 leading-relaxed">
            Positiviteiten curates positive news from around the world. Add sources,
            fetch articles, write summaries in Dutch, French and English, then publish
            to the public site.
          </p>
        </div>
      </div>
    </div>
  );
}
