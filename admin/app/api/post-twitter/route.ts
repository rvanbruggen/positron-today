import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import crypto from "crypto";

const SITE_BASE = "https://positron.today";

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugFromPath(publishedPath: string): string {
  return publishedPath.split("/").pop()?.replace(/\.md$/, "") ?? "";
}

function postUrl(publishedPath: string): string {
  const slug = slugFromPath(publishedPath);
  return slug ? `${SITE_BASE}/posts/${slug}/` : SITE_BASE;
}

// ── OAuth 1.0a ────────────────────────────────────────────────────────────────

function buildOAuthHeader(method: string, url: string): string {
  const enc = (s: string) => encodeURIComponent(s);

  const params: Record<string, string> = {
    oauth_consumer_key:     process.env.TWITTER_API_KEY!,
    oauth_nonce:            crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp:        Math.floor(Date.now() / 1000).toString(),
    oauth_token:            process.env.TWITTER_ACCESS_TOKEN!,
    oauth_version:          "1.0",
  };

  // Signature base string: sorted params (no body params for JSON requests)
  const sortedParams = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${enc(k)}=${enc(v)}`)
    .join("&");

  const baseString = [method.toUpperCase(), enc(url), enc(sortedParams)].join("&");

  const signingKey = `${enc(process.env.TWITTER_API_SECRET!)}&${enc(process.env.TWITTER_ACCESS_SECRET!)}`;
  const signature  = crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");

  params.oauth_signature = signature;

  return "OAuth " + Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${enc(k)}="${enc(v)}"`)
    .join(", ");
}

// ── Tweet text builder ────────────────────────────────────────────────────────
// X limit: 280 chars. URLs are always wrapped to 23 chars (t.co).
// Budget: 280 - 23 (url) - 2 (\n\n before url) = 255 for prefix + summary.

function buildTweetText(emoji: string, title: string, summary: string, url: string): string {
  const X_MAX      = 280;
  const URL_LEN    = 23; // t.co wrapping
  const suffix     = `\n\n${url}`;
  const suffixCost = URL_LEN + 2; // \n\n counts as 2
  const prefix     = `${emoji} ${title}\n\n`;
  const available  = X_MAX - suffixCost - prefix.length;

  const snippet = available <= 0
    ? ""
    : summary.length > available
      ? summary.slice(0, available - 1) + "…"
      : summary;

  return `${prefix}${snippet}${suffix}`;
}

// ── API route ─────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const missing = ["TWITTER_API_KEY", "TWITTER_API_SECRET", "TWITTER_ACCESS_TOKEN", "TWITTER_ACCESS_SECRET"]
    .filter((k) => !process.env[k]);
  if (missing.length) {
    return NextResponse.json({ error: `Missing env vars: ${missing.join(", ")}` }, { status: 500 });
  }

  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // Fetch article
  const result = await db.execute({
    sql: `SELECT title_en, title_nl, summary_en, published_path, article_emoji
          FROM articles WHERE id = ? AND status = 'published'`,
    args: [id],
  });
  const row = result.rows[0];
  if (!row) return NextResponse.json({ error: "Article not found" }, { status: 404 });

  const title   = String(row.title_en ?? row.title_nl ?? "");
  const summary = String(row.summary_en ?? "");
  const emoji   = String(row.article_emoji ?? "✨");
  const pubPath = row.published_path ? String(row.published_path) : null;

  if (!pubPath) {
    return NextResponse.json(
      { error: "Article has no published path — publish it to the site first" },
      { status: 400 }
    );
  }

  const url  = postUrl(pubPath);
  const text = buildTweetText(emoji, title, summary, url);

  const TWEET_URL = "https://api.twitter.com/2/tweets";

  try {
    const authHeader = buildOAuthHeader("POST", TWEET_URL);

    const res = await fetch(TWEET_URL, {
      method:  "POST",
      headers: {
        Authorization:  authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    const data = await res.json();

    if (!res.ok) {
      const msg = data?.detail ?? data?.title ?? JSON.stringify(data);
      throw new Error(`X API error: ${msg}`);
    }

    return NextResponse.json({ success: true, id: data.data?.id });

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Twitter post error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
