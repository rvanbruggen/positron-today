import db from "@/lib/db";

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

export async function POST() {
  try {
    if (!GITHUB_TOKEN || !GITHUB_REPO) {
      return Response.json({ error: "GITHUB_TOKEN and GITHUB_REPO must be set" }, { status: 500 });
    }

    // Fetch the most recent 300 rejections with a reason
    const result = await db.execute(`
      SELECT source_name, url, title, rejection_reason, fetched_at
      FROM rejected_articles
      WHERE rejection_reason IS NOT NULL AND rejection_reason != ''
      ORDER BY fetched_at DESC
      LIMIT 300
    `);

    const stats = await db.execute(`
      SELECT
        COUNT(*) as total,
        COUNT(DISTINCT source_name) as sources,
        COUNT(DISTINCT substr(fetched_at,1,7)) as months
      FROM rejected_articles
    `);

    const payload = {
      exported_at: new Date().toISOString(),
      total_rejected: Number(stats.rows[0]?.total ?? 0),
      sources_count: Number(stats.rows[0]?.sources ?? 0),
      articles: result.rows.map(r => ({
        source: r.source_name as string,
        title: r.title as string,
        reason: r.rejection_reason as string,
        url: r.url as string,
        date: String(r.fetched_at).slice(0, 10),
      })),
    };

    const json = JSON.stringify(payload, null, 2);
    await commitToGitHub(
      "site/src/_data/rejections.json",
      json,
      `Update rejection log (${payload.articles.length} articles)`
    );

    return Response.json({ ok: true, exported: payload.articles.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
