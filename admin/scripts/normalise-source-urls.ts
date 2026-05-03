/**
 * One-off cleanup: normalise the `url` column on the sources table so every
 * row has a valid absolute URL the public site can drop straight into an
 * <a href="...">.
 *
 * Background: the public About page's source pills go to 404 when the DB row
 * has a scheme-less URL like "www.politiken.dk" — the browser treats those
 * as relative paths and resolves them against /about/. The export step
 * (admin/lib/export-sources.ts) now sanitises on the way out, so the public
 * JSON is safe regardless, but rows in the DB stay verbatim until edited.
 * This script normalises them in place so the admin UI also shows clean
 * values when someone clicks "Edit".
 *
 * Usage:
 *   node --env-file=.env.local --experimental-strip-types scripts/normalise-source-urls.ts
 *   node --env-file=.env.local --experimental-strip-types scripts/normalise-source-urls.ts --apply
 *
 * Default is a dry run — it lists what would change and stops. Pass --apply
 * to write.
 */

import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.DATABASE_URL ?? "file:../local.db",
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

const APPLY = process.argv.includes("--apply");

function normaliseSourceUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  const m = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (m) return m[1].toLowerCase() + trimmed.slice(m[1].length);
  return `https://${trimmed}`;
}

async function main() {
  const all = await db.execute("SELECT id, name, url FROM sources ORDER BY name");

  type Change = { id: number; name: string; before: string; after: string };
  const changes: Change[] = [];

  for (const row of all.rows) {
    const id     = row.id as number;
    const name   = String(row.name);
    const before = String(row.url ?? "");
    const after  = normaliseSourceUrl(before);
    if (before !== after) changes.push({ id, name, before, after });
  }

  if (changes.length === 0) {
    console.log(`Scanned ${all.rows.length} source(s). Nothing to normalise.`);
    return;
  }

  console.log(`Found ${changes.length} source(s) with URLs that need normalising:\n`);
  for (const c of changes) {
    console.log(`  • [${c.id}] ${c.name}`);
    console.log(`      before: ${JSON.stringify(c.before)}`);
    console.log(`      after:  ${JSON.stringify(c.after)}`);
  }

  if (!APPLY) {
    console.log("\nDry run. Pass --apply to actually update.");
    return;
  }

  console.log("\nApplying updates...");
  let updated = 0;
  for (const c of changes) {
    await db.execute({
      sql:  "UPDATE sources SET url = ? WHERE id = ?",
      args: [c.after, c.id],
    });
    updated++;
    console.log(`  ✓ ${c.name}`);
  }
  console.log(`\nDone. ${updated} source(s) updated.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
