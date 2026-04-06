import db from "./db";

const GITHUB_TOKEN  = process.env.GITHUB_TOKEN!;
const GITHUB_REPO   = process.env.GITHUB_REPO!;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH ?? "main";

async function commitToGitHub(path: string, content: string, message: string) {
  const encoded = Buffer.from(content).toString("base64");
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;

  let sha: string | undefined;
  const existing = await fetch(url, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" },
  });
  if (existing.ok) sha = (await existing.json()).sha;

  const body: Record<string, unknown> = { message, content: encoded, branch: GITHUB_BRANCH };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
}

type SourceRow = {
  name: string;
  url: string;
  feed_url: string | null;
  language: string;
};

export async function exportSources(): Promise<{ exported: number }> {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    throw new Error("GITHUB_TOKEN and GITHUB_REPO must be set");
  }

  const result = await db.execute(`
    SELECT name, url, feed_url, language
    FROM sources
    WHERE active = 1
      AND url NOT LIKE '%manual.positron-today%'
    ORDER BY language, name ASC
  `);

  const rows = result.rows as unknown as SourceRow[];

  // Group by language; preserve insertion order (en, nl, fr) in the JSON
  const byLanguage: Record<string, { name: string; url: string; feed_url: string | null }[]> = {
    en: [], nl: [], fr: [],
  };
  for (const row of rows) {
    const lang = row.language in byLanguage ? row.language : "en";
    byLanguage[lang].push({
      name:     row.name,
      url:      row.url,
      feed_url: row.feed_url || null,
    });
  }

  const payload = {
    exported_at: new Date().toISOString(),
    total: rows.length,
    by_language: byLanguage,
  };

  await commitToGitHub(
    "site/src/_data/sources.json",
    JSON.stringify(payload, null, 2),
    `Update sources list (${rows.length} active sources)`
  );

  return { exported: rows.length };
}
