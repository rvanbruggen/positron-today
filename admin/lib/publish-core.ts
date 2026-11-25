/**
 * Publish core logic — extracted from the API route so both the
 * serverless endpoint and the unified self-hosted pipeline can call it.
 */

import db from "@/lib/db";
import { acquireLock, lockHolder, releaseLock } from "@/lib/run-lock";
import { parseScheduleWallString } from "@/lib/schedule-time";

const GITHUB_TOKEN  = process.env.GITHUB_TOKEN!;
const GITHUB_REPO   = process.env.GITHUB_REPO!;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH ?? "main";

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60)
    .replace(/-$/, "");
}

export function yamlStr(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function generateMarkdown(article: Record<string, unknown>, tagNames: string[]): string {
  const title = String(article.title_en ?? article.title_nl ?? "Untitled");
  const date = new Date().toISOString().slice(0, 19);

  const sourcePubDate = article.source_pub_date
    ? String(article.source_pub_date).slice(0, 10)
    : null;
  const fetchedDate = article.fetched_at
    ? String(article.fetched_at).slice(0, 10)
    : null;

  const primaryTag = tagNames[0] ?? "";
  const emoji = String(article.article_emoji ?? "📰");

  return [
    `---`,
    `title: ${yamlStr(title)}`,
    `title_nl: ${yamlStr(String(article.title_nl ?? title))}`,
    `title_fr: ${yamlStr(String(article.title_fr ?? title))}`,
    `date: ${date}`,
    ...(sourcePubDate ? [`source_pub_date: ${sourcePubDate}`] : []),
    ...(fetchedDate   ? [`fetched_date: ${fetchedDate}`]      : []),
    `source_url: ${yamlStr(String(article.source_url))}`,
    `source_name: ${yamlStr(String(article.source_name))}`,
    `topic: ${yamlStr(primaryTag)}`,
    `tags: ${JSON.stringify(tagNames)}`,
    `emoji: ${yamlStr(emoji)}`,
    `summary: ${yamlStr(String(article.summary_en ?? ""))}`,
    `summary_nl: ${yamlStr(String(article.summary_nl ?? ""))}`,
    `summary_fr: ${yamlStr(String(article.summary_fr ?? ""))}`,
    ...(article.image_url ? [`image_url: ${yamlStr(String(article.image_url))}`] : []),
    ...(Number(article.featured ?? 0) === 1 ? [`featured: true`] : []),
    `layout: post.njk`,
    `---`,
    ``,
    String(article.summary_en ?? ""),
  ].join("\n");
}

export async function commitToGitHub(path: string, content: string, message: string) {
  const encoded = Buffer.from(content).toString("base64");
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;
  const headers = { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" };
  const payloadKB = Math.round(encoded.length / 1024);

  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      let sha: string | undefined;
      const existing = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
      if (existing.ok) sha = (await existing.json()).sha;

      const body: Record<string, unknown> = { message, content: encoded, branch: GITHUB_BRANCH };
      if (sha) body.sha = sha;

      console.log(`[commitToGitHub] PUT ${path} (${payloadKB} KB, attempt ${attempt + 1}/${MAX_RETRIES})`);

      const res = await fetch(url, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });

      if (res.ok) return;

      if (res.status === 409 && attempt < MAX_RETRIES - 1) {
        console.warn(`[commitToGitHub] SHA conflict on ${path}, attempt ${attempt + 1}, retrying…`);
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }

      throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
    } catch (err) {
      const cause = err instanceof Error && "cause" in err ? ` (cause: ${(err as { cause?: unknown }).cause})` : "";
      if (attempt < MAX_RETRIES - 1) {
        console.warn(`[commitToGitHub] ${path} attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : err}${cause}, retrying…`);
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw new Error(`commitToGitHub ${path} failed after ${MAX_RETRIES} attempts: ${err instanceof Error ? err.message : err}${cause}`);
    }
  }
}

export interface GitHubFileEntry {
  path: string;
  content: string;
  encoding?: "utf-8" | "base64";
}

/**
 * Commit several files in ONE commit via the Git Data API.
 *
 * Each separate Contents-API commit triggers its own GitHub Pages build, and
 * bursts of 3–4 commits seconds apart were cancelling each other's deploys
 * mid-flight (Nov 2026). Batching keeps one publish cycle = one push.
 *
 * Retries the whole sequence from a fresh branch ref, so a concurrent commit
 * landing between our read and the ref update (non-fast-forward → 422) is
 * absorbed instead of failing.
 */
export async function commitMultipleToGitHub(files: GitHubFileEntry[], message: string) {
  if (files.length === 0) return;
  const apiBase = `https://api.github.com/repos/${GITHUB_REPO}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };
  const t = (ms: number) => AbortSignal.timeout(ms);

  // Blobs don't depend on the base commit, so create them once.
  const treeEntries: Array<{ path: string; mode: string; type: string; sha: string }> = [];
  for (const file of files) {
    const blobRes = await fetch(`${apiBase}/git/blobs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content: file.content, encoding: file.encoding ?? "utf-8" }),
      signal: t(60_000),
    });
    if (!blobRes.ok) throw new Error(`Failed to create blob for ${file.path}: ${blobRes.status}`);
    const blobSha = (await blobRes.json()).sha;
    treeEntries.push({ path: file.path, mode: "100644", type: "blob", sha: blobSha });
  }

  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const refRes = await fetch(`${apiBase}/git/ref/heads/${GITHUB_BRANCH}`, { headers, signal: t(30_000) });
      if (!refRes.ok) throw new Error(`Failed to get branch ref: ${refRes.status}`);
      const latestSha = (await refRes.json()).object.sha;

      const commitRes = await fetch(`${apiBase}/git/commits/${latestSha}`, { headers, signal: t(30_000) });
      if (!commitRes.ok) throw new Error(`Failed to get commit: ${commitRes.status}`);
      const baseTreeSha = (await commitRes.json()).tree.sha;

      const treeRes = await fetch(`${apiBase}/git/trees`, {
        method: "POST",
        headers,
        body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
        signal: t(60_000),
      });
      if (!treeRes.ok) throw new Error(`Failed to create tree: ${treeRes.status}`);
      const newTreeSha = (await treeRes.json()).sha;

      const newCommitRes = await fetch(`${apiBase}/git/commits`, {
        method: "POST",
        headers,
        body: JSON.stringify({ message, tree: newTreeSha, parents: [latestSha] }),
        signal: t(30_000),
      });
      if (!newCommitRes.ok) throw new Error(`Failed to create commit: ${newCommitRes.status}`);
      const newCommitSha = (await newCommitRes.json()).sha;

      const updateRefRes = await fetch(`${apiBase}/git/refs/heads/${GITHUB_BRANCH}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ sha: newCommitSha }),
        signal: t(30_000),
      });
      if (!updateRefRes.ok) throw new Error(`Failed to update ref: ${updateRefRes.status}`);

      console.log(`[commitMultipleToGitHub] Committed ${files.length} files in ${newCommitSha.slice(0, 8)}`);
      return;
    } catch (err) {
      if (attempt < MAX_RETRIES - 1) {
        console.warn(`[commitMultipleToGitHub] attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : err}, retrying…`);
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

/**
 * A file staged for a batched commit, with the commit-message line that a
 * standalone commit of it would have used.
 */
export interface StagedFile extends GitHubFileEntry {
  message: string;
}

/**
 * Commit staged files together. One file → the usual single-file commit with
 * its own message. Several → one batched commit; if the batch fails, fall back
 * to committing each file on its own so nothing is lost.
 */
export async function commitStagedFiles(files: StagedFile[], summary: string): Promise<void> {
  if (files.length === 0) return;
  if (files.length === 1) {
    await commitToGitHub(files[0].path, files[0].content, files[0].message);
    return;
  }
  const message = `${summary}\n\n${files.map((f) => `- ${f.message}`).join("\n")}`;
  try {
    await commitMultipleToGitHub(files, message);
  } catch (err) {
    console.warn(`[commitStagedFiles] batch commit failed (${err instanceof Error ? err.message : err}), committing files one by one`);
    const errors: string[] = [];
    for (const f of files) {
      try {
        await commitToGitHub(f.path, f.content, f.message);
      } catch (e) {
        errors.push(`${f.path}: ${e instanceof Error ? e.message : e}`);
      }
    }
    if (errors.length) throw new Error(`commitStagedFiles: ${errors.join("; ")}`);
  }
}

/** Current text of a file on the branch, or null if missing/unreadable. Works for files over 1 MB. */
export async function fetchGitHubFileText(path: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}?ref=${encodeURIComponent(GITHUB_BRANCH)}`,
      {
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.raw+json" },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * True when `content` (JSON) matches what is already committed at `path`,
 * ignoring the given top-level timestamp keys. Used to skip commits whose only
 * change would be `exported_at` — each one costs a full Pages deploy.
 * Any doubt (fetch error, unparsable JSON) → false, so we commit as before.
 */
export async function jsonUnchangedOnGitHub(path: string, content: string, ignoreKeys: string[]): Promise<boolean> {
  const current = await fetchGitHubFileText(path);
  if (current == null) return false;
  try {
    const strip = (text: string) => {
      const obj = JSON.parse(text) as Record<string, unknown>;
      for (const k of ignoreKeys) delete obj[k];
      return JSON.stringify(obj);
    };
    return strip(current) === strip(content);
  } catch {
    return false;
  }
}

export async function deleteFromGitHub(path: string, message: string) {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;
  const headers = { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" };

  const existing = await fetch(url, { headers });
  if (!existing.ok) return;

  const { sha } = await existing.json();
  const res = await fetch(url, {
    method: "DELETE",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ message, sha, branch: GITHUB_BRANCH }),
  });

  if (!res.ok && res.status !== 404) {
    throw new Error(`GitHub delete error ${res.status}: ${await res.text()}`);
  }
}

/**
 * Re-commit the markdown for an already-published article so frontmatter
 * changes (e.g. the `featured` flag flipping the wide-card layout) reach the
 * live site without waiting for a manual republish.
 *
 * No-op for articles that have never been published (no `published_path`),
 * so callers can fire it unconditionally after a flag change.
 */
export async function republishArticle(id: number): Promise<boolean> {
  if (!GITHUB_TOKEN || !GITHUB_REPO) return false;

  const articleResult = await db.execute({
    sql: `SELECT a.*, r.source_pub_date, r.fetched_at
          FROM articles a
          LEFT JOIN raw_articles r ON a.raw_article_id = r.id
          WHERE a.id = ?`,
    args: [id],
  });
  const article = articleResult.rows[0];
  if (!article || !article.published_path) return false;

  const tagsResult = await db.execute({
    sql: `SELECT t.name FROM article_tags at2
          JOIN topics t ON at2.tag_id = t.id
          WHERE at2.article_id = ?
          ORDER BY t.name ASC`,
    args: [id],
  });
  const tagNames = tagsResult.rows.map((r) => String(r.name));

  const path = String(article.published_path);
  const title = String(article.title_en ?? article.title_nl ?? path);
  const markdown = generateMarkdown(article as Record<string, unknown>, tagNames);
  await commitToGitHub(path, markdown, `Update post: ${title}`);
  return true;
}

// ─── Main publish logic ──────────────────────────────────────────────────────

export interface PublishResult {
  published: number;
  failed: number;
  results: Array<{ id: number; title: string; ok: boolean; path?: string; error?: string }>;
  /** True when another publish run holds the lock and this call did nothing. */
  busy?: boolean;
  error?: string;
}

/** Settings row used as the publish lock. */
const PUBLISH_LOCK_KEY = "publish_lock";

/** A publish is one GitHub commit per due article; 10 minutes is far beyond normal. */
const PUBLISH_LOCK_STALE_MS = 10 * 60_000;

/**
 * Publish every scheduled article that is due.
 *
 * Serialised across all callers, because there are four of them and they
 * overlap constantly: the NAS cron every 30 minutes, the per-article timers in
 * publish-timer.ts (one setTimeout per scheduled article, each publishing the
 * whole due set), and two call sites in the unified pipeline. Selecting the due
 * rows and marking them published are separated by a GitHub round trip, so
 * concurrent callers all saw the same rows as still 'scheduled' and all
 * committed. That is what produced 494 redundant "Add post" commits between
 * 2026-08-20 and 2026-09-08 — one story was committed twelve times.
 *
 * The commits were harmless to the site (same path, so each overwrote the last)
 * but they burn GitHub API calls, and a duplicate social post is not harmless.
 */
export async function publishScheduledArticles(): Promise<PublishResult> {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    return { published: 0, failed: 0, results: [], error: "GITHUB_TOKEN and GITHUB_REPO must be set" };
  }

  const lock = await acquireLock(PUBLISH_LOCK_KEY, "publish", PUBLISH_LOCK_STALE_MS);
  if (!lock) {
    const holder = await lockHolder(PUBLISH_LOCK_KEY, PUBLISH_LOCK_STALE_MS);
    console.log(
      `[publish-scheduled] Another publish run is in progress` +
      `${holder ? ` (started ${Math.round((Date.now() - holder.at) / 1000)}s ago)` : ""} — skipping`,
    );
    return { published: 0, failed: 0, results: [], busy: true };
  }

  try {
    return await publishScheduledArticlesLocked();
  } finally {
    await releaseLock(PUBLISH_LOCK_KEY, lock.token);
  }
}

/** The actual publish. Only ever called with the publish lock held. */
async function publishScheduledArticlesLocked(): Promise<PublishResult> {

  const allScheduled = await db.execute(`
    SELECT a.*, r.source_pub_date, r.fetched_at
    FROM articles a
    LEFT JOIN raw_articles r ON a.raw_article_id = r.id
    WHERE a.status = 'scheduled'
      AND a.summary_en IS NOT NULL
      AND a.publish_date IS NOT NULL
    ORDER BY a.publish_date ASC
  `);

  const now = new Date();
  const due = allScheduled.rows.filter((r) => {
    const publishAt = parseScheduleWallString(String(r.publish_date));
    return publishAt <= now;
  });

  if (due.length === 0) {
    return { published: 0, failed: 0, results: [] };
  }

  const results: Array<{ id: number; title: string; ok: boolean; path?: string; error?: string }> = [];

  // Prepare every due article first, then commit them together: several
  // posts falling due at once used to become several pushes seconds apart,
  // each starting (and cancelling) a GitHub Pages deploy.
  type Prepared = { id: number; title: string; path: string; markdown: string; message: string };
  const prepared: Prepared[] = [];

  for (const article of due) {
    const id = Number(article.id);
    const title = String(article.title_en ?? article.title_nl ?? article.id);

    try {
      const tagsResult = await db.execute({
        sql: `SELECT t.name FROM article_tags at2
              JOIN topics t ON at2.tag_id = t.id
              WHERE at2.article_id = ?
              ORDER BY t.name ASC`,
        args: [id],
      });
      const tagNames = tagsResult.rows.map((r) => String(r.name));

      const dateStr = new Date().toISOString().slice(0, 10);
      const path: string = article.published_path
        ? String(article.published_path)
        : `site/src/posts/${dateStr}-${slugify(title)}.md`;

      const markdown = generateMarkdown(article as Record<string, unknown>, tagNames);
      const isRepublish = !!article.published_path;
      prepared.push({
        id, title, path, markdown,
        message: isRepublish ? `Update post: ${title}` : `Add post: ${title}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[publish-scheduled] Failed to prepare article ${id}:`, message);
      results.push({ id, title, ok: false, error: message });
    }
  }

  const markPublished = async (p: Prepared) => {
    await db.execute({
      sql: "UPDATE articles SET status = 'published', published_at = datetime('now'), published_path = ? WHERE id = ?",
      args: [p.path, p.id],
    });
    results.push({ id: p.id, title: p.title, ok: true, path: p.path });
  };

  let batched = false;
  if (prepared.length > 1) {
    try {
      await commitMultipleToGitHub(
        prepared.map((p) => ({ path: p.path, content: p.markdown })),
        `Add ${prepared.length} posts\n\n${prepared.map((p) => `- ${p.message}`).join("\n")}`,
      );
      batched = true;
    } catch (err) {
      console.warn(
        `[publish-scheduled] Batch commit of ${prepared.length} posts failed ` +
        `(${err instanceof Error ? err.message : err}), committing one by one`,
      );
    }
  }

  for (const p of prepared) {
    try {
      if (!batched) await commitToGitHub(p.path, p.markdown, p.message);
      await markPublished(p);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[publish-scheduled] Failed to publish article ${p.id}:`, message);
      results.push({ id: p.id, title: p.title, ok: false, error: message });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  return { published: succeeded, failed, results };
}
