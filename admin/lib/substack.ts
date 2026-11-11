import { SubstackClient } from "substack-api";
import db from "@/lib/db";

const SITE_BASE = "https://positron.today";
const PUBLICATION_URL = "https://positrontoday.substack.com";

function getClient(): SubstackClient {
  const sid = process.env.SUBSTACK_SID;
  if (!sid) throw new Error("SUBSTACK_SID is not set — add your substack.sid cookie to .env");
  return new SubstackClient({ publicationUrl: PUBLICATION_URL, token: sid });
}

/**
 * Check that SUBSTACK_SID is still a valid login.
 *
 * Calls the drafts list, which needs a logged-in session (drafts are private),
 * rather than the public archive: the archive answers 200 without a login, so
 * it reported "connected" even with an expired cookie.
 */
export async function checkSubstackHealth(): Promise<{ ok: boolean; error?: string }> {
  const sid = process.env.SUBSTACK_SID;
  if (!sid) return { ok: false, error: "SUBSTACK_SID env var is not set" };
  try {
    const res = await fetch(`${PUBLICATION_URL}/api/v1/drafts?offset=0&limit=1`, {
      headers: { Cookie: `substack.sid=${sid}` },
      redirect: "manual",
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: `Substack rejected the login (${res.status}) — the SUBSTACK_SID cookie has likely expired` };
    }
    if (!res.ok) return { ok: false, error: `Substack drafts API returned ${res.status}` };
    const body = await res.json().catch(() => null);
    if (!Array.isArray(body)) {
      return { ok: false, error: "Substack drafts API did not return a draft list — the cookie may not be a valid login" };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

// ── Last cross-post failure ────────────────────────────────────────────────
// Posting runs in the background (publish timer, digest pick), so a failure
// never reaches the admin UI. Keep the most recent one in the settings table
// so the Settings page can show it; a successful post clears it.

const LAST_ERROR_KEY = "substack_last_error";

export interface SubstackFailure {
  at: string;
  articleId: number;
  title: string;
  error: string;
}

async function recordFailure(failure: SubstackFailure): Promise<void> {
  try {
    await db.execute({
      sql: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      args: [LAST_ERROR_KEY, JSON.stringify(failure)],
    });
  } catch (err) {
    console.error("[substack] Could not record failure:", err instanceof Error ? err.message : err);
  }
}

async function clearFailure(): Promise<void> {
  try {
    await db.execute({ sql: "DELETE FROM settings WHERE key = ?", args: [LAST_ERROR_KEY] });
  } catch {
    // Non-critical
  }
}

export async function getLastSubstackFailure(): Promise<SubstackFailure | null> {
  try {
    const r = await db.execute({ sql: "SELECT value FROM settings WHERE key = ?", args: [LAST_ERROR_KEY] });
    const v = r.rows[0]?.value;
    return v ? (JSON.parse(String(v)) as SubstackFailure) : null;
  } catch {
    return null;
  }
}

// Same selection as postPendingSubstack(), shared so the status count matches
// what will actually be posted.
const PENDING_WHERE = `
  status = 'published'
  AND (post_to_substack = 1 OR digest_pick = 1)
  AND substack_posted_at IS NULL
  AND published_at >= '2026-06-25'
`;

export async function countPendingSubstack(): Promise<number> {
  try {
    const r = await db.execute(`SELECT COUNT(*) AS n FROM articles WHERE ${PENDING_WHERE}`);
    return Number(r.rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

// ── Author ID ──────────────────────────────────────────────────────────────
// Drafts need a byline (`draft_bylines`) with the author's Substack user ID.
// It used to be read from the single newest archive post only, so as soon as
// that newest item had no `publishedBylines` every cross-post failed with
// "Could not determine Substack author ID". Now, in order:
//   1. SUBSTACK_USER_ID env var, if set
//   2. the ID cached in the settings table after an earlier lookup
//   3. the first post with a byline among the newest 25 archive posts
// and the ID found in step 3 is cached so later posts don't depend on the
// archive at all.

const AUTHOR_ID_KEY = "substack_author_id";

export async function getSubstackAuthorId(cookie: string): Promise<number> {
  const fromEnv = Number(process.env.SUBSTACK_USER_ID);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;

  try {
    const r = await db.execute({ sql: "SELECT value FROM settings WHERE key = ?", args: [AUTHOR_ID_KEY] });
    const cached = Number(r.rows[0]?.value);
    if (Number.isInteger(cached) && cached > 0) return cached;
  } catch {
    // settings table unavailable — fall through to the archive
  }

  const archiveRes = await fetch(`${PUBLICATION_URL}/api/v1/archive?sort=new&limit=25`, {
    headers: { Cookie: cookie },
  });
  if (!archiveRes.ok) throw new Error(`Failed to fetch Substack archive (${archiveRes.status})`);
  const archive = await archiveRes.json();
  // The archive used to be a bare array of posts; since early November 2026 it
  // is an object: { posts: [...], nextCursor }. Accept both.
  const posts: Array<Record<string, unknown>> = Array.isArray(archive)
    ? archive
    : Array.isArray(archive?.posts) ? archive.posts : [];

  for (const post of posts) {
    const bylines = post.publishedBylines as Array<{ id?: unknown }> | undefined;
    const id = Number(bylines?.[0]?.id);
    if (Number.isInteger(id) && id > 0) {
      try {
        await db.execute({
          sql: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          args: [AUTHOR_ID_KEY, String(id)],
        });
      } catch {
        // caching is an optimisation only
      }
      return id;
    }
  }

  // Say what the archive held, so the cause can be read from the error itself.
  const first = posts[0];
  const detail = first
    ? `newest item: "${String(first.title ?? "")}" (type ${String(first.type ?? "?")}, fields: ${Object.keys(first).slice(0, 40).join(", ")})`
    : `archive returned ${Array.isArray(archive) || Array.isArray(archive?.posts) ? "no posts" : `an object with fields ${Object.keys(archive ?? {}).join(", ")}`}`;
  throw new Error(
    `Could not determine Substack author ID: none of the newest ${posts.length} archive posts has publishedBylines — ${detail}. ` +
    `Set SUBSTACK_USER_ID in .env.docker to your Substack user ID to bypass this lookup.`,
  );
}

function buildPostBodyJson(article: Record<string, unknown>) {
  const emoji = String(article.article_emoji ?? "✨");
  const summary = String(article.summary_en ?? "");
  const sourceUrl = String(article.source_url ?? "");
  const sourceName = String(article.source_name ?? "");

  const slug = article.published_path
    ? String(article.published_path).split("/").pop()?.replace(/\.md$/, "")
    : null;
  const siteUrl = slug ? `${SITE_BASE}/posts/${slug}/` : SITE_BASE;

  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: summary }],
      },
      { type: "horizontal_rule" },
      {
        type: "paragraph",
        content: [
          { type: "text", text: `${emoji} ` },
          {
            type: "text",
            marks: [{ type: "link", attrs: { href: sourceUrl } }],
            text: `Read the original article on ${sourceName} ↗`,
          },
        ],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            marks: [{ type: "link", attrs: { href: siteUrl } }],
            text: "See this article on Positron.today ↗",
          },
        ],
      },
    ],
  };
}

async function createAndPublishDraft(
  title: string,
  subtitle: string,
  bodyJson: Record<string, unknown>,
  coverImageUrl: string | null,
): Promise<{ id: number; url: string }> {
  const sid = process.env.SUBSTACK_SID!;
  const cookie = `substack.sid=${sid}`;

  const userId = await getSubstackAuthorId(cookie);

  const draftPayload: Record<string, unknown> = {
    draft_title: title,
    draft_subtitle: subtitle,
    draft_body: JSON.stringify(bodyJson),
    draft_bylines: [{ id: userId, is_guest: false }],
    type: "newsletter",
  };
  if (coverImageUrl) draftPayload.cover_image = coverImageUrl;

  // Create draft
  const draftRes = await fetch(`${PUBLICATION_URL}/api/v1/drafts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify(draftPayload),
  });

  if (!draftRes.ok) {
    const text = await draftRes.text();
    throw new Error(`Failed to create Substack draft (${draftRes.status}): ${text}`);
  }

  const createdDraft = await draftRes.json();
  const draftId = createdDraft.id as number;

  // Publish draft
  const pubRes = await fetch(`${PUBLICATION_URL}/api/v1/drafts/${draftId}/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({}),
  });

  if (!pubRes.ok) {
    const text = await pubRes.text();
    throw new Error(`Failed to publish Substack draft ${draftId} (${pubRes.status}): ${text}`);
  }

  const published = await pubRes.json();
  return {
    id: draftId,
    url: published.canonical_url ?? `${PUBLICATION_URL}/p/${createdDraft.slug ?? draftId}`,
  };
}

export interface SubstackPostResult {
  ok: boolean;
  error?: string;
  url?: string;
}

export async function postToSubstack(articleId: number): Promise<SubstackPostResult> {
  const sid = process.env.SUBSTACK_SID;
  if (!sid) return { ok: false, error: "SUBSTACK_SID is not set" };

  // Claim this article with an optimistic lock: set substack_posted_at now
  // so concurrent calls to postPendingSubstack() skip it.
  const claimed = await db.execute({
    sql: `UPDATE articles SET substack_posted_at = datetime('now')
          WHERE id = ? AND substack_posted_at IS NULL RETURNING *`,
    args: [articleId],
  });
  const article = claimed.rows[0];
  if (!article) {
    // Either not found or already posted
    const exists = await db.execute({ sql: "SELECT id FROM articles WHERE id = ?", args: [articleId] });
    if (!exists.rows[0]) return { ok: false, error: `Article ${articleId} not found` };
    return { ok: false, error: "Already posted to Substack" };
  }

  const title = String(article.title_en ?? article.title_nl ?? "Untitled");
  const bodyJson = buildPostBodyJson(article as Record<string, unknown>);
  const imageUrl = article.image_url ? String(article.image_url) : null;

  const slug = article.published_path
    ? String(article.published_path).split("/").pop()?.replace(/\.md$/, "")
    : null;
  const siteUrl = slug ? `${SITE_BASE}/posts/${slug}/` : SITE_BASE;
  const subtitle = "Originally published on Positron.today";

  try {
    const { url } = await createAndPublishDraft(title, subtitle, bodyJson, imageUrl);

    console.log(`[substack] Posted article ${articleId}: "${title}" → ${url}`);
    await clearFailure();
    return { ok: true, url };
  } catch (err) {
    // Roll back the claim so the article can be retried
    await db.execute({
      sql: "UPDATE articles SET substack_posted_at = NULL WHERE id = ?",
      args: [articleId],
    });
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[substack] Failed to post article ${articleId}:`, msg);
    await recordFailure({ at: new Date().toISOString(), articleId, title, error: msg.slice(0, 1000) });
    if (msg.includes("401") || msg.includes("403") || msg.includes("authentication")) {
      console.error("[substack] ⚠ Your SUBSTACK_SID cookie has likely expired. Sign into Substack in your browser, copy the new substack.sid cookie value, and update the SUBSTACK_SID env var.");
    }
    return { ok: false, error: msg };
  }
}

export async function postPendingSubstack(): Promise<{ posted: number; skipped: number }> {
  const sid = process.env.SUBSTACK_SID;
  if (!sid) {
    console.log("[substack] SUBSTACK_SID not set, skipping");
    return { posted: 0, skipped: 0 };
  }

  const pending = await db.execute(`
    SELECT id, title_en, title_nl
    FROM articles
    WHERE ${PENDING_WHERE}
    ORDER BY published_at ASC
  `);

  let posted = 0;
  let skipped = 0;

  for (const row of pending.rows) {
    const id = Number(row.id);
    const r = await postToSubstack(id);
    if (r.ok) posted++;
    else skipped++;
  }

  return { posted, skipped };
}
