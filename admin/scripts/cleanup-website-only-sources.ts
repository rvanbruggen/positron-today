/**
 * One-off cleanup: remove legacy sources that have no RSS feed URL.
 *
 * The sources page no longer accepts website-only entries (v2.14.2). Any rows
 * left over from before are orphaned — they can't be auto-fetched, and the UI
 * doesn't render them. The "Manual" source is the one intentional exception:
 * it's the bucket /api/manual-url writes into for one-off pasted URLs.
 *
 * Usage:
 *   node --env-file=.env.local --experimental-strip-types scripts/cleanup-website-only-sources.ts
 *   node --env-file=.env.local --experimental-strip-types scripts/cleanup-website-only-sources.ts --apply
 *
 * Default is a dry run — it lists what would be removed and stops. Pass
 * --apply to actually delete. Deletion cascades to pending raw_articles for
 * each target source; published articles survive (the FK in articles is
 * nullable and has no ON DELETE cascade).
 */

import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.DATABASE_URL ?? "file:../local.db",
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

const APPLY = process.argv.includes("--apply");

async function main() {
  const targets = await db.execute(
    "SELECT id, name, url, language FROM sources WHERE feed_url IS NULL AND name <> 'Manual' ORDER BY name"
  );

  if (targets.rows.length === 0) {
    console.log("Nothing to clean up. No website-only sources remain (other than 'Manual').");
    return;
  }

  console.log(`Found ${targets.rows.length} legacy website-only source(s):\n`);

  for (const s of targets.rows) {
    const rawCount = await db.execute({
      sql: "SELECT COUNT(*) AS c FROM raw_articles WHERE source_id = ?",
      args: [s.id as number],
    });
    const articleCount = await db.execute({
      sql: "SELECT COUNT(*) AS c FROM articles WHERE raw_article_id IN (SELECT id FROM raw_articles WHERE source_id = ?)",
      args: [s.id as number],
    });
    console.log(`  • [${s.id}] ${s.name} (${s.language})`);
    console.log(`      url:          ${s.url}`);
    console.log(`      raw_articles: ${rawCount.rows[0].c} (will be deleted)`);
    console.log(`      articles:     ${articleCount.rows[0].c} (kept; raw_article_id will dangle)`);
  }

  if (!APPLY) {
    console.log("\nDry run. Pass --apply to actually delete.");
    return;
  }

  console.log("\nApplying deletions...");
  let removed = 0;
  for (const s of targets.rows) {
    await db.execute({ sql: "DELETE FROM raw_articles WHERE source_id = ?", args: [s.id as number] });
    await db.execute({ sql: "DELETE FROM sources WHERE id = ?",             args: [s.id as number] });
    removed++;
    console.log(`  ✓ removed ${s.name}`);
  }
  console.log(`\nDone. ${removed} source(s) removed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
