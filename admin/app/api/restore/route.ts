/**
 * POST /api/restore
 *
 * Wipes the current database and restores from a backup JSON produced by
 * GET /api/backup.
 *
 * Request body: the parsed backup JSON (application/json).
 *
 * ⚠ Destructive — all existing data is deleted before restoring.
 */

import db from "@/lib/db";
import type { InValue } from "@libsql/client";

// JSON null → SQL null, everything else cast to InValue
function toArgs(values: unknown[]): InValue[] {
  return values.map((v) => (v === undefined ? null : (v as InValue)));
}

interface BackupFile {
  version: number;
  exported_at: string;
  tables: Record<string, Record<string, unknown>[]>;
}

// Tables that have AUTOINCREMENT sequences to reset
const SEQUENCE_TABLES = ["sources", "topics", "articles", "rejected_articles"];

export async function POST(request: Request) {
  let backup: BackupFile;
  try {
    backup = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!backup?.version || !backup?.tables) {
    return Response.json(
      { error: "Not a valid Positron backup file (missing version or tables)." },
      { status: 400 },
    );
  }

  if (backup.version !== 1) {
    return Response.json(
      { error: `Unsupported backup version: ${backup.version}` },
      { status: 400 },
    );
  }

  const { tables } = backup;
  const stats: Record<string, number> = {};

  try {
    // ── 0. Disable FK checks during restore ───────────────────────────────────
    await db.execute("PRAGMA foreign_keys = OFF");

    // ── 1. Wipe in dependency order ──────────────────────────────────────────
    await db.execute("DELETE FROM article_tags");
    await db.execute("DELETE FROM articles");
    await db.execute("DELETE FROM rejected_articles");
    await db.execute("DELETE FROM topics");
    await db.execute("DELETE FROM sources");
    await db.execute("DELETE FROM settings");

    // ── 2. Restore each table ────────────────────────────────────────────────

    // sources
    for (const row of tables.sources ?? []) {
      const keys = Object.keys(row);
      const placeholders = keys.map(() => "?").join(", ");
      await db.execute({
        sql:  `INSERT OR REPLACE INTO sources (${keys.join(", ")}) VALUES (${placeholders})`,
        args: toArgs(Object.values(row)),
      });
    }
    stats.sources = (tables.sources ?? []).length;

    // topics
    for (const row of tables.topics ?? []) {
      const keys = Object.keys(row);
      const placeholders = keys.map(() => "?").join(", ");
      await db.execute({
        sql:  `INSERT OR REPLACE INTO topics (${keys.join(", ")}) VALUES (${placeholders})`,
        args: toArgs(Object.values(row)),
      });
    }
    stats.topics = (tables.topics ?? []).length;

    // articles
    for (const row of tables.articles ?? []) {
      const keys = Object.keys(row);
      const placeholders = keys.map(() => "?").join(", ");
      await db.execute({
        sql:  `INSERT OR REPLACE INTO articles (${keys.join(", ")}) VALUES (${placeholders})`,
        args: toArgs(Object.values(row)),
      });
    }
    stats.articles = (tables.articles ?? []).length;

    // article_tags
    for (const row of tables.article_tags ?? []) {
      await db.execute({
        sql:  "INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)",
        args: toArgs([row.article_id, row.tag_id]),
      });
    }
    stats.article_tags = (tables.article_tags ?? []).length;

    // rejected_articles
    for (const row of tables.rejected_articles ?? []) {
      const keys = Object.keys(row);
      const placeholders = keys.map(() => "?").join(", ");
      await db.execute({
        sql:  `INSERT OR REPLACE INTO rejected_articles (${keys.join(", ")}) VALUES (${placeholders})`,
        args: toArgs(Object.values(row)),
      });
    }
    stats.rejected_articles = (tables.rejected_articles ?? []).length;

    // settings
    for (const row of tables.settings ?? []) {
      await db.execute({
        sql:  "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
        args: toArgs([row.key, row.value]),
      });
    }
    stats.settings = (tables.settings ?? []).length;

    // ── 3. Reset AUTOINCREMENT sequences ─────────────────────────────────────
    for (const table of SEQUENCE_TABLES) {
      const rows = tables[table] ?? [];
      if (rows.length === 0) continue;
      const maxId = Math.max(...rows.map((r) => Number(r.id ?? 0)));
      if (maxId > 0) {
        await db.execute({
          sql:  "UPDATE sqlite_sequence SET seq = ? WHERE name = ?",
          args: [maxId, table],
        });
      }
    }

    // ── 4. Re-enable FK checks ─────────────────────────────────────────────
    await db.execute("PRAGMA foreign_keys = ON");

  } catch (err) {
    // Re-enable FK checks even on error
    try { await db.execute("PRAGMA foreign_keys = ON"); } catch { /* ok */ }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Restore failed: ${message}` }, { status: 500 });
  }

  return Response.json({
    ok: true,
    restored_from: backup.exported_at,
    stats,
  });
}
