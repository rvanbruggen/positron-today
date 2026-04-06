import db from "./db";

export async function initSchema() {
  // Core tables (idempotent)
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('rss', 'website')),
      language TEXT NOT NULL DEFAULT 'en',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      emoji TEXT NOT NULL DEFAULT '📰',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS raw_articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL REFERENCES sources(id),
      url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      content TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'discarded'))
    );

    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_article_id INTEGER REFERENCES raw_articles(id),
      topic_id INTEGER REFERENCES topics(id),
      source_url TEXT NOT NULL,
      source_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'scheduled', 'published')),
      publish_date TEXT,
      title_nl TEXT,
      title_fr TEXT,
      title_en TEXT,
      summary_nl TEXT,
      summary_fr TEXT,
      summary_en TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      published_at TEXT
    );
  `);

  // Migrations — each is safe to run repeatedly; errors are silently ignored
  const migrations = [
    // v0.4: per-article emoji chosen by Claude during summarisation
    "ALTER TABLE articles ADD COLUMN article_emoji TEXT",

    // v0.4: many-to-many article ↔ tag join table
    `CREATE TABLE IF NOT EXISTS article_tags (
      article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      tag_id     INTEGER NOT NULL REFERENCES topics(id)   ON DELETE CASCADE,
      PRIMARY KEY (article_id, tag_id)
    )`,

    // v0.7: RSS feed URL separate from website URL on sources
    "ALTER TABLE sources ADD COLUMN feed_url TEXT",

    // v0.7: store AI-rejected articles with reason for the negativity-bias log
    `CREATE TABLE IF NOT EXISTS rejected_articles (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id      INTEGER REFERENCES sources(id) ON DELETE SET NULL,
      source_name    TEXT NOT NULL DEFAULT '',
      url            TEXT NOT NULL UNIQUE,
      title          TEXT NOT NULL,
      snippet        TEXT,
      rejection_reason TEXT,
      fetched_at     TEXT NOT NULL DEFAULT (datetime('now'))
    )`,

    // v0.8: key-value settings store for configurable LLM providers
    `CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,

    // v0.8.1: remember the GitHub path used when an article was first published
    // so re-publishing always overwrites the same file instead of creating a new one
    "ALTER TABLE articles ADD COLUMN published_path TEXT",
  ];

  for (const sql of migrations) {
    try { await db.execute(sql); } catch { /* already applied */ }
  }

  // One-time data migration: promote existing topic_id → article_tags
  try {
    await db.execute(`
      INSERT OR IGNORE INTO article_tags (article_id, tag_id)
      SELECT id, topic_id FROM articles WHERE topic_id IS NOT NULL
    `);
  } catch { /* already migrated */ }
}
