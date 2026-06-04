import db from "./db";
import { formatRejectionTimestamp } from "./schedule-time";

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

  // Cap at 1,000 most recent articles for the browsable list.
  // Stats (total count, category breakdown) are always computed across the full dataset.
  const [articles, stats] = await Promise.all([
    db.execute(`
      SELECT source_name, url, title, rejection_reason, rejection_category, fetched_at
      FROM rejected_articles
      ORDER BY fetched_at DESC
      LIMIT 1000
    `),
    db.execute(`
      SELECT
        COUNT(*) as total,
        COUNT(DISTINCT source_name) as sources,
        COUNT(DISTINCT rejection_category) as categories_used
      FROM rejected_articles
    `),
  ]);

  // Category breakdown counts
  const catResult = await db.execute(`
    SELECT rejection_category, COUNT(*) as cnt
    FROM rejected_articles
    WHERE rejection_category IS NOT NULL AND rejection_category != ''
    GROUP BY rejection_category
    ORDER BY cnt DESC
  `);
  const category_breakdown = catResult.rows.map(r => ({
    category: r.rejection_category as string,
    count: Number(r.cnt),
  }));

  // Source breakdown: negative count + total count (negative + accepted) per source
  const sourceResult = await db.execute(`
    SELECT
      neg.source_name,
      neg.negative_count,
      neg.negative_count + COALESCE(pos.positive_count, 0) AS total_count
    FROM (
      SELECT source_name, COUNT(*) AS negative_count
      FROM rejected_articles
      GROUP BY source_name
    ) neg
    LEFT JOIN (
      SELECT s.name AS source_name, COUNT(*) AS positive_count
      FROM raw_articles ra
      JOIN sources s ON ra.source_id = s.id
      GROUP BY s.name
    ) pos ON neg.source_name = pos.source_name
    ORDER BY neg.negative_count DESC
  `);
  const source_breakdown = sourceResult.rows.map(r => ({
    source: r.source_name as string,
    negative: Number(r.negative_count),
    total: Number(r.total_count),
  }));

  const payload = {
    exported_at: new Date().toISOString(),
    total_rejected: Number(stats.rows[0]?.total ?? 0),
    sources_count:  Number(stats.rows[0]?.sources ?? 0),
    category_breakdown,
    source_breakdown,
    articles: articles.rows.map(r => ({
      source:   r.source_name as string,
      title:    r.title as string,
      reason:   (r.rejection_reason as string) || null,
      category: (r.rejection_category as string) || null,
      url:      r.url as string,
      date:     formatRejectionTimestamp(String(r.fetched_at)),
    })),
  };

  await commitToGitHub(
    "site/src/_data/rejections.json",
    JSON.stringify(payload, null, 2),
    `Update rejection log (${payload.articles.length} articles)`
  );

  return { exported: payload.articles.length };
}
