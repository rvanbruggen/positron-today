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

export async function exportRejections(): Promise<{ exported: number }> {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    throw new Error("GITHUB_TOKEN and GITHUB_REPO must be set");
  }

  const [articles, stats] = await Promise.all([
    db.execute(`
      SELECT source_name, url, title, rejection_reason, fetched_at
      FROM rejected_articles
      ORDER BY fetched_at DESC
      LIMIT 300
    `),
    db.execute(`
      SELECT
        COUNT(*) as total,
        COUNT(DISTINCT source_name) as sources
      FROM rejected_articles
    `),
  ]);

  const payload = {
    exported_at: new Date().toISOString(),
    total_rejected: Number(stats.rows[0]?.total ?? 0),
    sources_count:  Number(stats.rows[0]?.sources ?? 0),
    articles: articles.rows.map(r => ({
      source: r.source_name as string,
      title:  r.title as string,
      reason: (r.rejection_reason as string) || null,
      url:    r.url as string,
      date:   String(r.fetched_at).slice(0, 10),
    })),
  };

  await commitToGitHub(
    "site/src/_data/rejections.json",
    JSON.stringify(payload, null, 2),
    `Update rejection log (${payload.articles.length} articles)`
  );

  return { exported: payload.articles.length };
}
