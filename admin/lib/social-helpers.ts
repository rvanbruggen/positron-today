import db from "@/lib/db";
import { withRetry } from "@/lib/retry";

const PFM_BASE = "https://api.postforme.dev/v1";
const API_KEY = process.env.POSTFORME_API_KEY!;

export function pfmHeaders() {
  return { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" };
}

export async function getEnabledAccounts(): Promise<{ id: string; platform: string }[]> {
  const settingsResult = await db.execute({
    sql: "SELECT value FROM settings WHERE key = 'postforme_enabled_accounts'",
    args: [],
  });
  if (settingsResult.rows.length === 0) return [];

  let enabledIds: string[] = [];
  try {
    enabledIds = JSON.parse(String(settingsResult.rows[0].value));
  } catch { return []; }
  if (enabledIds.length === 0) return [];

  const pfmRes = await withRetry(() => fetch(`${PFM_BASE}/social-accounts`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
    cache: "no-store",
  }), { label: "PFM list accounts" });
  if (!pfmRes.ok) return [];

  const pfmData = await pfmRes.json();
  const allAccounts: { id: string; platform: string }[] = (pfmData.data ?? []).map(
    (a: Record<string, string>) => ({ id: a.id, platform: a.platform }),
  );

  return allAccounts.filter((a) => enabledIds.includes(a.id));
}

export async function uploadCardToPostForMe(png: Buffer): Promise<string> {
  return withRetry(async () => {
    const urlRes = await fetch(`${PFM_BASE}/media/create-upload-url`, {
      method: "POST",
      headers: pfmHeaders(),
      body: JSON.stringify({ content_type: "image/png" }),
    });
    if (!urlRes.ok) {
      const err = await urlRes.json().catch(() => ({}));
      throw new Error(`Post for Me media URL failed: ${err.message ?? urlRes.status}`);
    }
    const { upload_url, media_url } = await urlRes.json();

    const putRes = await fetch(upload_url, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: new Uint8Array(png),
    });
    if (!putRes.ok) {
      throw new Error(`Media upload failed: ${putRes.status}`);
    }

    return media_url as string;
  }, { label: "PFM upload media" });
}

export async function postToPlatforms(
  accounts: string[],
  caption: string,
  mediaUrl?: string,
): Promise<{ id: string; status: string }> {
  const body: Record<string, unknown> = { caption, social_accounts: accounts };
  if (mediaUrl) body.media = [{ url: mediaUrl }];

  return withRetry(async () => {
    const res = await fetch(`${PFM_BASE}/social-posts`, {
      method: "POST",
      headers: pfmHeaders(),
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? `Post for Me error ${res.status}`);
    return { id: data.id, status: data.status };
  }, { label: "PFM post" });
}

/**
 * Twitter's weighted character count treats most emoji as 2 chars even though
 * JS .length returns 1 for BMP emoji. We add a safety buffer on top.
 */
export function twitterLen(s: string): number {
  let count = 0;
  for (const char of s) {
    const cp = char.codePointAt(0) ?? 0;
    const isEmoji = cp > 0x2100 && cp <= 0x1FAFF;
    count += (cp > 0xFFFF || isEmoji) ? 2 : 1;
  }
  return count;
}

export async function isUrlLive(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow" });
    return res.ok;
  } catch {
    return false;
  }
}

export function getApiKey(): string {
  return API_KEY;
}
