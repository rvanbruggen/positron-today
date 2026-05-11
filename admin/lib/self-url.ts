export function selfUrl(path: string): string {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}${path}`;
  }
  const port = process.env.PORT ?? "3000";
  return `http://localhost:${port}${path}`;
}

async function makeInternalToken(): Promise<string | null> {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode("positron-admin-v1"));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function selfFetch(path: string, body: object): Promise<Response> {
  const token = await makeInternalToken();
  return fetch(selfUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Cookie: `admin_session=${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}
