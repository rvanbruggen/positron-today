/**
 * POST /api/restore
 *
 * Wipes the current database and restores from a backup JSON produced by
 * GET /api/backup.
 *
 * Request body: the parsed backup JSON (application/json).
 *
 * ⚠ Destructive — all existing data is deleted before restoring.
 *
 * Uses db.batch() to send all inserts in a single round-trip, avoiding
 * Vercel's 10-second function timeout on the Hobby plan.
 */

import db from "@/lib/db";
import type { InStatement, InValue } from "@libsql/client";

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

function rowToStatement(table: string, row: Record<string, unknown>): InStatement {
  const keys = Object.keys(row);
  const placeholders = keys.map(() => "?").join(", ");
  return {
    sql: `INSERT OR REPLACE INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})`,
    args: toArgs(Object.values(row)),
  };
}

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
    // ── Build all statements into a single batch ──────────────────────────────
    const stmts: InStatement[] = [];

    // 1. Wipe in dependency order
    stmts.push("DELETE FROM article_tags");
    stmts.push("DELETE FROM articles");
    stmts.push("DELETE FROM raw_articles");
    stmts.push("DELETE FROM rejected_articles");
    stmts.push("DELETE FROM topics");
    stmts.push("DELETE FROM sources");
    stmts.push("DELETE FROM settings");

    // 2. Restore: sources
    for (const row of tables.sources ?? []) {
      stmts.push(rowToStatement("sources", row));
    }
    stats.sources = (tables.sources ?? []).length;

    // topics
    for (const row of tables.topics ?? []) {
      stmts.push(rowToStatement("topics", row));
    }
    stats.topics = (tables.topics ?? []).length;

    // articles (null out raw_article_id — raw_articles aren't in the backup)
    for (const row of tables.articles ?? []) {
      stmts.push(rowToStatement("articles", { ...row, raw_article_id: null }));
    }
    stats.articles = (tables.articles ?? []).length;

    // article_tags
    for (const row of tables.article_tags ?? []) {
      stmts.push({
        sql: "INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)",
        args: toArgs([row.article_id, row.tag_id]),
      });
    }
    stats.article_tags = (tables.article_tags ?? []).length;

    // rejected_articles
    for (const row of tables.rejected_articles ?? []) {
      stmts.push(rowToStatement("rejected_articles", row));
    }
    stats.rejected_articles = (tables.rejected_articles ?? []).length;

    // settings
    for (const row of tables.settings ?? []) {
      stmts.push({
        sql: "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
        args: toArgs([row.key, row.value]),
      });
    }
    stats.settings = (tables.settings ?? []).length;

    // 3. Reset AUTOINCREMENT sequences
    for (const table of SEQUENCE_TABLES) {
      const rows = tables[table] ?? [];
      if (rows.length === 0) continue;
      const maxId = Math.max(...rows.map((r) => Number(r.id ?? 0)));
      if (maxId > 0) {
        stmts.push({
          sql: "UPDATE sqlite_sequence SET seq = ? WHERE name = ?",
          args: [maxId, table],
        });
      }
    }

    // ── Execute everything in one batch round-trip ─────────────────────────────
    await db.batch(stmts, "write");

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Restore failed: ${message}` }, { status: 500 });
  }

  return Response.json({
    ok: true,
    restored_from: backup.exported_at,
    stats,
  });
}
