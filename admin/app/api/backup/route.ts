/**
 * GET /api/backup
 *
 * Exports the full database as a JSON file download.
 * The resulting file can be imported via POST /api/restore.
 *
 * Tables exported: sources, topics, articles, article_tags,
 *                  rejected_articles, settings
 *
 * raw_articles are intentionally omitted — they are large and
 * can always be re-fetched from source RSS feeds.
 */

import db from "@/lib/db";

const TABLES = [
  "sources",
  "topics",
  "articles",
  "article_tags",
  "rejected_articles",
  "settings",
] as const;

export async function GET() {
  const tables: Record<string, unknown[]> = {};

  for (const table of TABLES) {
    const result = await db.execute(`SELECT * FROM ${table} ORDER BY rowid ASC`);
    tables[table] = result.rows.map((row) => {
      // Convert Row object to plain JS object
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        obj[k] = v;
      }
      return obj;
    });
  }

  const backup = {
    version:     1,
    exported_at: new Date().toISOString(),
    tables,
  };

  const json     = JSON.stringify(backup, null, 2);
  const dateSlug = new Date().toISOString().slice(0, 10);

  return new Response(json, {
    headers: {
      "Content-Type":        "application/json",
      "Content-Disposition": `attachment; filename="positron-backup-${dateSlug}.json"`,
    },
  });
}
