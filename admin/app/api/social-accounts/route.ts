/**
 * GET /api/social-accounts
 *
 * Proxies the Post for Me account list, stripping access tokens
 * so they're never exposed to the browser.
 */

const PFM_BASE = "https://api.postforme.dev/v1";

export interface SocialAccount {
  id:                string;
  platform:          string;
  username:          string;
  profile_photo_url: string | null;
  status:            string;
}

export async function GET() {
  const apiKey = process.env.POSTFORME_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "POSTFORME_API_KEY not set" }, { status: 500 });
  }

  const res = await fetch(`${PFM_BASE}/social-accounts`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    // Always fetch fresh — don't cache in Next.js data cache
    cache: "no-store",
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return Response.json(
      { error: err.message ?? `Post for Me error ${res.status}` },
      { status: res.status },
    );
  }

  const data = await res.json();

  // Strip access/refresh tokens before returning to client
  const accounts: SocialAccount[] = (data.data ?? []).map((a: Record<string, unknown>) => ({
    id:                a.id,
    platform:          a.platform,
    username:          a.username,
    profile_photo_url: a.profile_photo_url ?? null,
    status:            a.status,
  }));

  return Response.json({ accounts });
}
