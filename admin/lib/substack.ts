import { SubstackClient } from "substack-api";
import db from "@/lib/db";

const SITE_BASE = "https://positron.today";
const PUBLICATION_URL = "https://positrontoday.substack.com";

function getClient(): SubstackClient {
  const sid = process.env.SUBSTACK_SID;
  if (!sid) throw new Error("SUBSTACK_SID is not set — add your substack.sid cookie to .env");
  return new SubstackClient({ publicationUrl: PUBLICATION_URL, token: sid });
}

export async function checkSubstackHealth(): Promise<{ ok: boolean; error?: string }> {
  const sid = process.env.SUBSTACK_SID;
  if (!sid) return { ok: false, error: "SUBSTACK_SID env var is not set" };
  try {
    const client = getClient();
    const reachable = await client.testConnectivity();
    if (!reachable) return { ok: false, error: "Substack API unreachable — cookie may have expired" };
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

function buildPostBody(article: Record<string, unknown>): string {
  const emoji = String(article.article_emoji ?? "✨");
  const summary = String(article.summary_en ?? "");
  const sourceUrl = String(article.source_url ?? "");
  const sourceName = String(article.source_name ?? "");

  const slug = article.published_path
    ? String(article.published_path).split("/").pop()?.replace(/\.md$/, "")
    : null;
  const siteUrl = slug ? `${SITE_BASE}/posts/${slug}/` : SITE_BASE;

  return [
    `<p>${summary}</p>`,
    `<hr>`,
    `<p>${emoji} <a href="${sourceUrl}">Read the original article on ${sourceName} ↗</a></p>`,
    `<p><a href="${siteUrl}">See this article on Positron.today ↗</a></p>`,
  ].join("\n");
}

async function createAndPublishDraft(
  title: string,
  subtitle: string,
  bodyHtml: string,
  coverImageUrl: string | null,
): Promise<{ id: number; url: string }> {
  const sid = process.env.SUBSTACK_SID!;
  const cookie = `substack.sid=${sid}`;

  const draftPayload: Record<string, unknown> = {
    draft_title: title,
    draft_subtitle: subtitle,
    draft_body: bodyHtml,
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

  const result = await db.execute({
    sql: "SELECT * FROM articles WHERE id = ?",
    args: [articleId],
  });
  const article = result.rows[0];
  if (!article) return { ok: false, error: `Article ${articleId} not found` };

  const title = String(article.title_en ?? article.title_nl ?? "Untitled");
  const bodyHtml = buildPostBody(article as Record<string, unknown>);
  const imageUrl = article.image_url ? String(article.image_url) : null;

  const slug = article.published_path
    ? String(article.published_path).split("/").pop()?.replace(/\.md$/, "")
    : null;
  const siteUrl = slug ? `${SITE_BASE}/posts/${slug}/` : SITE_BASE;
  const subtitle = `Read on Positron.today: ${siteUrl}`;

  try {
    const { url } = await createAndPublishDraft(title, subtitle, bodyHtml, imageUrl);

    await db.execute({
      sql: "UPDATE articles SET substack_posted_at = datetime('now') WHERE id = ?",
      args: [articleId],
    });

    console.log(`[substack] Posted article ${articleId}: "${title}" → ${url}`);
    return { ok: true, url };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[substack] Failed to post article ${articleId}:`, msg);
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
    WHERE status = 'published'
      AND post_to_substack = 1
      AND substack_posted_at IS NULL
      AND published_at >= datetime('now', '-24 hours')
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
