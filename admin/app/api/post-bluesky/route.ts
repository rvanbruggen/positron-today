import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";

const BSKY_SERVICE = "https://bsky.social";
const HANDLE       = process.env.BLUESKY_HANDLE;
const APP_PASSWORD = process.env.BLUESKY_APP_PASSWORD;
const SITE_BASE    = "https://positron.today";

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugFromPath(publishedPath: string): string {
  return publishedPath.split("/").pop()?.replace(/\.md$/, "") ?? "";
}

function postUrl(publishedPath: string): string {
  const slug = slugFromPath(publishedPath);
  return slug ? `${SITE_BASE}/posts/${slug}/` : SITE_BASE;
}

// Bluesky requires explicit facets (rich-text annotations) for links and mentions.
// This builds the UTF-8 byte positions for a link appended at the end of the text.
function buildPostWithLink(body: string, url: string) {
  const text     = `${body}\n\n${url}`;
  const encoder  = new TextEncoder();
  const bodyBytes = encoder.encode(`${body}\n\n`).length;
  const urlBytes  = encoder.encode(url).length;

  return {
    text,
    facets: [
      {
        index: { byteStart: bodyBytes, byteEnd: bodyBytes + urlBytes },
        features: [{ $type: "app.bsky.richtext.facet#link", uri: url }],
      },
    ],
  };
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function createSession(): Promise<{ accessJwt: string; did: string }> {
  const res = await fetch(`${BSKY_SERVICE}/xrpc/com.atproto.server.createSession`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ identifier: HANDLE, password: APP_PASSWORD }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Bluesky auth failed: ${err.message ?? res.status}`);
  }
  return res.json();
}

// ── Image upload ──────────────────────────────────────────────────────────────

async function uploadImageBlob(
  imageUrl: string,
  accessJwt: string
): Promise<{ $type: string; ref: { $link: string }; mimeType: string; size: number } | null> {
  try {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return null;
    const buffer   = await imgRes.arrayBuffer();
    const mimeType = imgRes.headers.get("content-type") ?? "image/jpeg";

    const uploadRes = await fetch(`${BSKY_SERVICE}/xrpc/com.atproto.repo.uploadBlob`, {
      method:  "POST",
      headers: {
        Authorization:   `Bearer ${accessJwt}`,
        "Content-Type":  mimeType,
      },
      body: buffer,
    });
    if (!uploadRes.ok) return null;
    const { blob } = await uploadRes.json();
    return blob;
  } catch {
    return null;
  }
}

// ── API route ─────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!HANDLE || !APP_PASSWORD) {
    return NextResponse.json(
      { error: "BLUESKY_HANDLE and BLUESKY_APP_PASSWORD must be set in .env.local" },
      { status: 500 }
    );
  }

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // Fetch article
  const result = await db.execute({
    sql: `SELECT title_en, title_nl, summary_en, image_url, published_path, article_emoji
          FROM articles WHERE id = ? AND status = 'published'`,
    args: [id],
  });
  const row = result.rows[0];
  if (!row) return NextResponse.json({ error: "Article not found" }, { status: 404 });

  const title       = String(row.title_en ?? row.title_nl ?? "");
  const summary     = String(row.summary_en ?? "");
  const imageUrl    = row.image_url ? String(row.image_url) : null;
  const emoji       = String(row.article_emoji ?? "✨");
  const pubPath     = row.published_path ? String(row.published_path) : null;

  if (!pubPath) {
    return NextResponse.json({ error: "Article has no published path — publish it to the site first" }, { status: 400 });
  }

  const url = postUrl(pubPath);

  // Bluesky hard limit: 300 graphemes.
  // Full text is: "{emoji} {title}\n\n{summary}\n\n{url}"
  // Calculate how many graphemes are left for the summary after the fixed parts.
  const BSKY_MAX  = 300;
  const prefix    = `${emoji} ${title}\n\n`;
  const suffix    = `\n\n${url}`;
  const available = BSKY_MAX - [...prefix].length - [...suffix].length - 1; // -1 safety margin
  const summarySnippet = available <= 0
    ? ""
    : [...summary].length > available
      ? [...summary].slice(0, available - 1).join("") + "…"
      : summary;
  const bodyText       = `${emoji} ${title}\n\n${summarySnippet}`;
  const { text, facets } = buildPostWithLink(bodyText, url);

  try {
    // 1. Auth
    const { accessJwt, did } = await createSession();

    // 2. Optionally upload image
    let embed: Record<string, unknown> | undefined;
    if (imageUrl) {
      const blob = await uploadImageBlob(imageUrl, accessJwt);
      if (blob) {
        embed = {
          $type: "app.bsky.embed.external",
          external: {
            uri:         url,
            title,
            description: summarySnippet,
            thumb:       blob,
          },
        };
      }
    }

    // If no image, still attach a link card (no thumb)
    if (!embed) {
      embed = {
        $type: "app.bsky.embed.external",
        external: {
          uri:         url,
          title,
          description: summarySnippet,
        },
      };
    }

    // 3. Create post
    const record: Record<string, unknown> = {
      $type:     "app.bsky.feed.post",
      text,
      facets,
      embed,
      createdAt: new Date().toISOString(),
      langs:     ["en"],
    };

    const postRes = await fetch(`${BSKY_SERVICE}/xrpc/com.atproto.repo.createRecord`, {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${accessJwt}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        repo:       did,
        collection: "app.bsky.feed.post",
        record,
      }),
    });

    if (!postRes.ok) {
      const err = await postRes.json().catch(() => ({}));
      throw new Error(`Bluesky post failed: ${err.message ?? postRes.status}`);
    }

    const postData = await postRes.json();
    return NextResponse.json({ success: true, uri: postData.uri });

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Bluesky post error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
