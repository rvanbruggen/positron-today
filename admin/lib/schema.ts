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

    // v0.9: rejection category slug for breakdown charts + backfill support
    "ALTER TABLE rejected_articles ADD COLUMN rejection_category TEXT",

    // v0.10: original source publication date captured from RSS isoDate/pubDate
    "ALTER TABLE raw_articles ADD COLUMN source_pub_date TEXT",

    // v0.10: same field on rejected_articles so rejections also carry the source date
    "ALTER TABLE rejected_articles ADD COLUMN source_pub_date TEXT",

    // v1.3: og:image captured at summarise time, stored for card thumbnails on the public site
    "ALTER TABLE articles ADD COLUMN image_url TEXT",

    // v1.11: timestamp of social media posting (previously referenced but never migrated)
    "ALTER TABLE articles ADD COLUMN social_posted_at TEXT",

    // v1.11: opt-in flag — when set, publish-scheduled also triggers a social media announcement
    "ALTER TABLE articles ADD COLUMN post_to_social_on_publish INTEGER NOT NULL DEFAULT 0",

    // v1.12: featured flag — card spans two columns on the public site
    "ALTER TABLE articles ADD COLUMN featured INTEGER NOT NULL DEFAULT 0",

    // v1.13: positivity score (1-10) assigned by the LLM during filtering
    "ALTER TABLE articles ADD COLUMN positivity_score REAL",
    "ALTER TABLE raw_articles ADD COLUMN positivity_score REAL",

    // v2.17: English-translated title/snippet for sources whose input language
    // is NOT one of the three output languages (en/nl/fr). Lets the human
    // reviewer evaluate Spanish/German/Danish/etc. articles on the Preview page
    // without having to read the original. Populated at fetch time as part of
    // the same LLM call that does the positivity filter.
    "ALTER TABLE raw_articles ADD COLUMN preview_title_en TEXT",
    "ALTER TABLE raw_articles ADD COLUMN preview_snippet_en TEXT",

    // Staging queue for the two-phase pipeline. Phase 1 (fetch) pulls RSS
    // items and inserts new ones here. Phase 2 (classify) drains this queue
    // through the LLM filter into raw_articles or rejected_articles.
    `CREATE TABLE IF NOT EXISTS pending_items (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id       INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
      url             TEXT NOT NULL UNIQUE,
      title           TEXT NOT NULL,
      snippet         TEXT,
      source_pub_date TEXT,
      queued_at       TEXT NOT NULL DEFAULT (datetime('now'))
    )`,

    // v2.20: server-side pipeline runs. Tracks progress so the client can
    // disconnect (e.g. mobile backgrounding) without interrupting the work.
    // Each row is one full fetch-feeds → classify cycle.
    `CREATE TABLE IF NOT EXISTS pipeline_runs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      status     TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'done', 'error')),
      phase      TEXT NOT NULL DEFAULT 'fetch',
      offset     INTEGER NOT NULL DEFAULT 0,
      total_sources   INTEGER NOT NULL DEFAULT 0,
      sources_done    INTEGER NOT NULL DEFAULT 0,
      queued     INTEGER NOT NULL DEFAULT 0,
      classified INTEGER NOT NULL DEFAULT 0,
      added      INTEGER NOT NULL DEFAULT 0,
      filtered   INTEGER NOT NULL DEFAULT 0,
      errored    INTEGER NOT NULL DEFAULT 0,
      queue_depth     INTEGER NOT NULL DEFAULT 0,
      error_message   TEXT,
      log        TEXT NOT NULL DEFAULT '[]',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    )`,

    // v2.23: task queue — each pipeline run is broken into discrete tasks
    // that any caller (browser poll or external cron) can pick up and execute.
    `CREATE TABLE IF NOT EXISTS pipeline_tasks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id      INTEGER NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
      kind        TEXT NOT NULL,
      seq         INTEGER NOT NULL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'done', 'error')),
      payload     TEXT NOT NULL DEFAULT '{}',
      error       TEXT,
      started_at  TEXT,
      finished_at TEXT
    )`,

    // v2.26: social digest — hand-pick articles for periodic bundled social posts
    "ALTER TABLE articles ADD COLUMN digest_pick INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE articles ADD COLUMN digest_posted_at TEXT",

    // v2.36: server-side "Summarise all" runs. Tracks progress so the
    // browser can disconnect (close the tab, background the app) without
    // interrupting the work — exactly like pipeline_runs does for fetch +
    // classify. Each row is one bulk-summarise-drafts cycle.
    `CREATE TABLE IF NOT EXISTS summarise_runs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      status        TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'done', 'error')),
      total         INTEGER NOT NULL DEFAULT 0,
      done          INTEGER NOT NULL DEFAULT 0,
      succeeded     INTEGER NOT NULL DEFAULT 0,
      failed        INTEGER NOT NULL DEFAULT 0,
      current_title TEXT,
      error_message TEXT,
      log           TEXT NOT NULL DEFAULT '[]',
      started_at    TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at   TEXT
    )`,

    // v2.38: Substack cross-posting
    "ALTER TABLE articles ADD COLUMN post_to_substack INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE articles ADD COLUMN substack_posted_at TEXT",
  ];

  for (const sql of migrations) {
    try { await db.execute(sql); } catch { /* already applied */ }
  }

  // v2.24: claim column so concurrent classify batches don't process the same rows
  try { await db.execute("ALTER TABLE pending_items ADD COLUMN claimed_at TEXT"); } catch { /* already applied */ }

  // One-time data migration: promote existing topic_id → article_tags
  try {
    await db.execute(`
      INSERT OR IGNORE INTO article_tags (article_id, tag_id)
      SELECT id, topic_id FROM articles WHERE topic_id IS NOT NULL
    `);
  } catch { /* already migrated */ }
}
