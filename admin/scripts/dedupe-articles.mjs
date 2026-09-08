/**
 * Remove duplicate `articles` rows left by concurrent Positronitron runs.
 *
 * Before the run lock landed in 4.0.5, overlapping runs each inserted their own
 * row for the same source article, so `raw_article_id` repeats — up to twelve
 * times for a single story. Each extra row also re-posted to social, since that
 * queue is guarded per row.
 *
 * Reports by default. Pass --apply to delete; it takes a consistent backup
 * first and does the deletion in one transaction.
 *
 *   docker compose exec admin node /app/scripts/dedupe-articles.mjs
 *   docker compose exec admin node /app/scripts/dedupe-articles.mjs --apply
 *
 * DATABASE_URL is read from the environment (the container already sets it).
 */

import { createClient } from "@libsql/client";

const url = process.env.DATABASE_URL ?? "file:/data/positron.db";
const apply = process.argv.includes("--apply");
const skipConflicts = process.argv.includes("--skip-conflicts");
const db = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN });

const one = async (sql, args = []) => Number((await db.execute({ sql, args })).rows[0]?.n ?? 0);

console.log(`Database: ${url}`);
console.log(apply ? "Mode:     APPLY (will delete)\n" : "Mode:     dry run\n");

// Which row of each duplicate set survives, in priority order:
//   1. one an editorial links to, so that link is not orphaned
//   2. one that is actually published and has a published_path
//   3. the most recently published — the repeat that overwrote the site file
//      last, so the surviving row's text matches what is live
//   4. highest id, as a stable tie-break
const KEEPERS = `
  SELECT id FROM (
    SELECT a.id,
           ROW_NUMBER() OVER (
             PARTITION BY a.raw_article_id
             ORDER BY
               (SELECT COUNT(*) FROM editorials e WHERE e.article_id = a.id) DESC,
               (a.status = 'published' AND COALESCE(a.published_path,'') <> '') DESC,
               COALESCE(a.published_at, '') DESC,
               a.id DESC
           ) AS rn
    FROM articles a
    WHERE a.raw_article_id IS NOT NULL
  ) WHERE rn = 1`;

// Sets where a row that would be deleted owns a published_path no surviving row
// carries — i.e. the repeat produced a second live file rather than overwriting
// the first. Deleting the row would leave that file with nothing describing it,
// so these need a human decision about which page to remove.
const CONFLICTED = `
  SELECT DISTINCT d.raw_article_id FROM articles d
  WHERE d.raw_article_id IS NOT NULL
    AND d.id NOT IN (${KEEPERS})
    AND COALESCE(d.published_path,'') <> ''
    AND d.published_path NOT IN (
      SELECT COALESCE(k.published_path,'') FROM articles k WHERE k.id IN (${KEEPERS}))`;

const DOOMED = `
  SELECT id FROM articles
  WHERE raw_article_id IS NOT NULL
    AND raw_article_id IN (
      SELECT raw_article_id FROM articles
      WHERE raw_article_id IS NOT NULL
      GROUP BY raw_article_id HAVING COUNT(*) > 1)
    AND id NOT IN (${KEEPERS})
    ${skipConflicts ? `AND raw_article_id NOT IN (${CONFLICTED})` : ""}`;

const total   = await one("SELECT COUNT(*) AS n FROM articles");
const sets    = await one(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM articles
                           WHERE raw_article_id IS NOT NULL
                           GROUP BY raw_article_id HAVING COUNT(*) > 1)`);
const doomed  = (await db.execute(DOOMED)).rows.map((r) => Number(r.id));

console.log(`articles total:      ${total}`);
console.log(`duplicated stories:  ${sets}`);
console.log(`rows to delete:      ${doomed.length}\n`);

if (doomed.length === 0) {
  console.log("Nothing to do.");
  process.exit(0);
}

const worst = await db.execute(`
  SELECT raw_article_id, COUNT(*) AS copies,
         SUBSTR(MIN(COALESCE(title_en,'(untitled)')), 1, 60) AS title
  FROM articles WHERE raw_article_id IS NOT NULL
  GROUP BY raw_article_id HAVING copies > 1
  ORDER BY copies DESC, raw_article_id LIMIT 15`);
console.log("Worst offenders:");
for (const r of worst.rows) console.log(`  ${String(r.copies).padStart(3)}×  ${r.title}`);

// A row the site still points at must never be deleted. If a doomed row owns a
// published_path its survivor does not also carry, the live file would be left
// with no row describing it — refuse rather than guess.
const orphans = await one(`
  SELECT COUNT(*) AS n FROM articles d
  WHERE d.id IN (${DOOMED})
    AND COALESCE(d.published_path,'') <> ''
    AND d.published_path NOT IN (
      SELECT COALESCE(k.published_path,'') FROM articles k WHERE k.id IN (${KEEPERS}))`);

if (orphans > 0) {
  console.error(`\nSTOP: ${orphans} row(s) to delete own a published_path no surviving row carries.`);
  console.error("Deleting them would leave live files with no article row. Nothing changed.");
  console.error("Re-run with --skip-conflicts to clean the rest and leave these for a human.");
  process.exit(1);
}
console.log("\nChecked: every published_path on a doomed row is also carried by its survivor.");

const conflicted = (await db.execute(CONFLICTED)).rows.map((r) => Number(r.raw_article_id));
if (conflicted.length > 0) {
  console.log(`\nSkipping ${conflicted.length} set(s) that produced two live files ` +
              `(raw_article_id ${conflicted.join(", ")}) — these need a page deleted, not just a row.`);
}

if (!apply) {
  console.log("\nDry run — nothing changed. Re-run with --apply to delete.");
  process.exit(0);
}

// VACUUM INTO writes a consistent snapshot even with an active WAL, which a
// plain file copy would not.
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = url.startsWith("file:") ? url.slice(5).replace(/\/[^/]*$/, "") : "/data";
const backup = `${dir}/positron-pre-dedupe-${stamp}.db`;
console.log(`\nBacking up to ${backup}`);
await db.execute({ sql: `VACUUM INTO '${backup}'`, args: [] });

console.log("Deleting...");
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const stmts = [];
for (const ids of chunk(doomed, 200)) {
  const ph = ids.map(() => "?").join(",");
  stmts.push({ sql: `DELETE FROM article_tags WHERE article_id IN (${ph})`, args: ids });
  stmts.push({ sql: `DELETE FROM articles     WHERE id         IN (${ph})`, args: ids });
}
await db.batch(stmts, "write");

const stillDuped = await one(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM articles
                              WHERE raw_article_id IS NOT NULL
                              GROUP BY raw_article_id HAVING COUNT(*) > 1)`);
if (stillDuped === 0) {
  console.log("Installing the unique index...");
  await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_raw_article_id
                    ON articles(raw_article_id) WHERE raw_article_id IS NOT NULL`);
} else {
  console.log(`Not installing the unique index — ${stillDuped} duplicate set(s) still remain.`);
}

const left = await one(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM articles
                        WHERE raw_article_id IS NOT NULL
                        GROUP BY raw_article_id HAVING COUNT(*) > 1)`);
console.log(`\nDone. ${doomed.length} rows deleted, ${await one("SELECT COUNT(*) AS n FROM articles")} remain.`);
console.log(`Remaining duplicates: ${left} (must be 0)`);
console.log(`Backup kept at ${backup}`);
