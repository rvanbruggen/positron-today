import db from "@/lib/db";
import { getSummariseProvider } from "@/lib/llm";
import { DEFAULT_SUMMARISE_STYLE } from "@/lib/prompts";
import { slugify, yamlStr, commitToGitHub, deleteFromGitHub } from "@/lib/publish-core";
import { postEditorialToSubstack } from "@/lib/editorial-substack";

const LANG_LABELS: Record<string, string> = {
  en: "English",
  nl: "Dutch (Nederlands)",
  fr: "French (Français)",
};

function parseImageFilenames(raw: unknown): string[] {
  if (!raw || typeof raw !== "string") return [];
  try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : [raw]; } catch { return [raw]; }
}

function parseImageDatas(raw: unknown): string[] {
  if (!raw || typeof raw !== "string") return [];
  try { const arr = JSON.parse(raw); return Array.isArray(arr) ? arr : [raw]; } catch { return [raw]; }
}

function rewriteImagePaths(content: string, filenames: string[]): string {
  const filenameSet = new Set(filenames);
  return content.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
    const basename = src.split("/").pop() ?? src;
    if (filenameSet.has(basename) || filenameSet.has(src)) {
      return `![${alt}](/assets/editorials/${basename})`;
    }
    return match;
  });
}

// ─── Translation ─────────────────────────────────────────────────────────────

const REQUIRED_FIELDS = [
  "title_en", "title_nl", "title_fr",
  "summary_en", "summary_nl", "summary_fr",
] as const;

export async function translateEditorial(id: number): Promise<{
  title_en: string; title_nl: string; title_fr: string;
  summary_en: string; summary_nl: string; summary_fr: string;
  content_en: string; content_nl: string; content_fr: string;
  emoji: string;
}> {
  const row = await db.execute({ sql: "SELECT * FROM editorials WHERE id = ?", args: [id] });
  const editorial = row.rows[0];
  if (!editorial) throw new Error(`Editorial ${id} not found`);

  const srcLang = String(editorial.source_language || "en");
  const srcField = `content_${srcLang}` as const;
  const sourceContent = String(editorial[srcField] || "");
  if (!sourceContent.trim()) throw new Error(`No content in source language (${srcLang})`);

  const otherLangs = ["en", "nl", "fr"].filter(l => l !== srcLang);
  const otherLabels = otherLangs.map(l => LANG_LABELS[l]).join(" and ");

  const prompt = `${DEFAULT_SUMMARISE_STYLE}

You are translating an editorial article written by Rik Van Bruggen about the Positron Today project.

The editorial is written in ${LANG_LABELS[srcLang]}. Translate it fully into ${otherLabels}.

IMPORTANT:
- Preserve the author's writing style, tone, and personality faithfully in each translation.
- Translate the COMPLETE text - every paragraph, every sentence. Do not summarise or shorten.
- Keep any markdown formatting (headings, bold, italic, links, lists) intact.
- The summaries should be 4-5 sentences each, capturing the essence of the editorial.

Here is the full editorial:

${sourceContent}

Output ONLY this exact JSON object and nothing else. All fields are required:
{
  "title_en": "Title in English",
  "title_nl": "Titel in het Nederlands",
  "title_fr": "Titre en français",
  "summary_en": "4-5 sentence summary in English.",
  "summary_nl": "Samenvatting van 4-5 zinnen in het Nederlands.",
  "summary_fr": "Résumé de 4-5 phrases en français.",
  "content_${otherLangs[0]}": "Full translated editorial in ${LANG_LABELS[otherLangs[0]]}.",
  "content_${otherLangs[1]}": "Full translated editorial in ${LANG_LABELS[otherLangs[1]]}.",
  "emoji": "✍️"
}`;

  const systemPrompt = "You output only raw JSON. No prose, no markdown fences, no explanation. Every response must be a single complete JSON object with all fields filled in. Translations must be complete and faithful to the original.";

  const str = (v: unknown, fallback = "") => (typeof v === "string" && v.trim() ? v.trim() : fallback);
  const MAX_ATTEMPTS = 2;
  const provider = await getSummariseProvider();
  let missingFields: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const finalPrompt = (attempt > 1 && missingFields.length > 0)
      ? `${prompt}\n\nRETRY ${attempt}/${MAX_ATTEMPTS}: Your previous response had these fields empty or missing: ${missingFields.join(", ")}. Every field MUST contain text.`
      : prompt;

    const raw = await provider.generate(finalPrompt, systemPrompt, 16000);
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      missingFields = ["(no JSON found in response)"];
      console.warn(`[editorial] attempt ${attempt}/${MAX_ATTEMPTS}: ${missingFields[0]}`);
      if (attempt === MAX_ATTEMPTS) throw new Error(`Unexpected LLM response: ${raw.slice(0, 120)}`);
      continue;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      missingFields = ["(JSON parse error)"];
      console.warn(`[editorial] attempt ${attempt}/${MAX_ATTEMPTS}: JSON parse failed`);
      if (attempt === MAX_ATTEMPTS) throw new Error(`LLM returned invalid JSON after ${MAX_ATTEMPTS} attempts`);
      continue;
    }

    const result = {
      title_en: str(parsed.title_en),
      title_nl: str(parsed.title_nl),
      title_fr: str(parsed.title_fr),
      summary_en: str(parsed.summary_en),
      summary_nl: str(parsed.summary_nl),
      summary_fr: str(parsed.summary_fr),
      content_en: str(parsed.content_en, String(editorial.content_en || "")),
      content_nl: str(parsed.content_nl, String(editorial.content_nl || "")),
      content_fr: str(parsed.content_fr, String(editorial.content_fr || "")),
      emoji: str(parsed.emoji, "✍️"),
    };

    // The source language content stays as-is (the LLM shouldn't overwrite it)
    result[`content_${srcLang}` as keyof typeof result] = sourceContent;

    missingFields = REQUIRED_FIELDS.filter(f => !result[f]);
    const missingContent = otherLangs.filter(l => !result[`content_${l}` as keyof typeof result]);
    if (missingContent.length > 0) missingFields.push(...missingContent.map(l => `content_${l}`));

    if (missingFields.length === 0) {
      await db.execute({
        sql: `UPDATE editorials SET
          title_en = ?, title_nl = ?, title_fr = ?,
          summary_en = ?, summary_nl = ?, summary_fr = ?,
          content_en = ?, content_nl = ?, content_fr = ?,
          article_emoji = ?, status = 'ready', updated_at = datetime('now')
          WHERE id = ?`,
        args: [
          result.title_en, result.title_nl, result.title_fr,
          result.summary_en, result.summary_nl, result.summary_fr,
          result.content_en, result.content_nl, result.content_fr,
          result.emoji, id,
        ],
      });

      return result;
    }

    console.warn(`[editorial] attempt ${attempt}/${MAX_ATTEMPTS}: missing fields: ${missingFields.join(", ")}`);
    if (attempt === MAX_ATTEMPTS) {
      throw new Error(`LLM failed to provide all translations after ${MAX_ATTEMPTS} attempts. Missing: ${missingFields.join(", ")}`);
    }
  }

  throw new Error("Translation failed unexpectedly");
}

// ─── Markdown generation ─────────────────────────────────────────────────────

export function generateEditorialPageMarkdown(editorial: Record<string, unknown>): string {
  const title = String(editorial.title_en ?? "Untitled");
  const date = new Date().toISOString().slice(0, 19);
  const emoji = String(editorial.article_emoji ?? "✍️");
  const filenames = parseImageFilenames(editorial.image_filename);

  const lines = [
    `---`,
    `title: ${yamlStr(title)}`,
    `title_nl: ${yamlStr(String(editorial.title_nl ?? title))}`,
    `title_fr: ${yamlStr(String(editorial.title_fr ?? title))}`,
    `date: ${date}`,
    `emoji: ${yamlStr(emoji)}`,
    `summary: ${yamlStr(String(editorial.summary_en ?? ""))}`,
    `summary_nl: ${yamlStr(String(editorial.summary_nl ?? ""))}`,
    `summary_fr: ${yamlStr(String(editorial.summary_fr ?? ""))}`,
  ];

  if (filenames.length > 0) {
    lines.push(`image_url: ${yamlStr(`/assets/editorials/${filenames[0]}`)}`);
  }

  // Store NL/FR content in frontmatter for the trilingual template
  // Use block scalar (|) for multiline content; rewrite image paths
  const contentNl = rewriteImagePaths(String(editorial.content_nl ?? ""), filenames);
  const contentFr = rewriteImagePaths(String(editorial.content_fr ?? ""), filenames);
  if (contentNl) {
    lines.push(`content_nl: |`);
    for (const line of contentNl.split("\n")) {
      lines.push(`  ${line}`);
    }
  }
  if (contentFr) {
    lines.push(`content_fr: |`);
    for (const line of contentFr.split("\n")) {
      lines.push(`  ${line}`);
    }
  }

  lines.push(`layout: editorial.njk`);
  lines.push(`---`);
  lines.push(``);
  lines.push(rewriteImagePaths(String(editorial.content_en ?? ""), filenames));

  return lines.join("\n");
}

export function generateEditorialCardMarkdown(editorial: Record<string, unknown>): string {
  const title = String(editorial.title_en ?? "Untitled");
  const date = new Date().toISOString().slice(0, 19);
  const emoji = String(editorial.article_emoji ?? "✍️");
  const slug = String(editorial.slug ?? "");
  const filenames = parseImageFilenames(editorial.image_filename);

  const lines = [
    `---`,
    `title: ${yamlStr(title)}`,
    `title_nl: ${yamlStr(String(editorial.title_nl ?? title))}`,
    `title_fr: ${yamlStr(String(editorial.title_fr ?? title))}`,
    `date: ${date}`,
    `source_url: ${yamlStr(`/editorials/${slug}/`)}`,
    `source_name: ${yamlStr("Positron Today")}`,
    `topic: ${yamlStr("Editorial")}`,
    `tags: ["Editorial"]`,
    `emoji: ${yamlStr(emoji)}`,
    `summary: ${yamlStr(String(editorial.summary_en ?? ""))}`,
    `summary_nl: ${yamlStr(String(editorial.summary_nl ?? ""))}`,
    `summary_fr: ${yamlStr(String(editorial.summary_fr ?? ""))}`,
  ];

  if (filenames.length > 0) {
    lines.push(`image_url: ${yamlStr(`/assets/editorials/${filenames[0]}`)}`);
  }

  lines.push(`featured: true`);
  lines.push(`layout: post.njk`);
  lines.push(`---`);
  lines.push(``);
  lines.push(String(editorial.summary_en ?? ""));

  return lines.join("\n");
}

// ─── Publish orchestrator ────────────────────────────────────────────────────

export interface EditorialPublishResult {
  ok: boolean;
  editorialPath?: string;
  cardPath?: string;
  substackUrl?: string;
  error?: string;
}

export async function publishEditorial(id: number): Promise<EditorialPublishResult> {
  const row = await db.execute({ sql: "SELECT * FROM editorials WHERE id = ?", args: [id] });
  const editorial = row.rows[0];
  if (!editorial) return { ok: false, error: `Editorial ${id} not found` };
  if (editorial.status !== "ready") return { ok: false, error: `Editorial is not ready (status: ${editorial.status})` };

  const slug = String(editorial.slug);
  const title = String(editorial.title_en ?? "Untitled");
  const dateStr = new Date().toISOString().slice(0, 10);

  try {
    // 1. Commit all images if present
    const filenames = parseImageFilenames(editorial.image_filename);
    const datas = parseImageDatas(editorial.image_data);
    for (let i = 0; i < filenames.length; i++) {
      if (filenames[i] && datas[i]) {
        const imagePath = `site/src/assets/editorials/${filenames[i]}`;
        await commitImageToGitHub(imagePath, datas[i], `Add editorial image: ${filenames[i]}`);
      }
    }

    // 2. Commit full editorial page
    const editorialPath = `site/src/editorials/${slug}.md`;
    const editorialMd = generateEditorialPageMarkdown(editorial as Record<string, unknown>);
    await commitToGitHub(editorialPath, editorialMd, `Add editorial: ${title}`);

    // 3. Commit homepage card
    const cardPath = `site/src/posts/${dateStr}-editorial-${slug}.md`;
    const cardMd = generateEditorialCardMarkdown(editorial as Record<string, unknown>);
    await commitToGitHub(cardPath, cardMd, `Add editorial card: ${title}`);

    // 4. Create corresponding articles row for the homepage
    const articleResult = await db.execute({
      sql: `INSERT INTO articles (
        source_url, source_name, status, title_en, title_nl, title_fr,
        summary_en, summary_nl, summary_fr, article_emoji, image_url,
        featured, published_at, published_path, post_to_substack
      ) VALUES (?, ?, 'published', ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), ?, ?)
      RETURNING id`,
      args: [
        `/editorials/${slug}/`,
        "Positron Today",
        String(editorial.title_en ?? ""),
        String(editorial.title_nl ?? ""),
        String(editorial.title_fr ?? ""),
        String(editorial.summary_en ?? ""),
        String(editorial.summary_nl ?? ""),
        String(editorial.summary_fr ?? ""),
        String(editorial.article_emoji ?? "✍️"),
        filenames.length > 0 ? `/assets/editorials/${filenames[0]}` : null,
        cardPath,
        Number(editorial.post_to_substack ?? 1),
      ],
    });

    const articleId = articleResult.rows[0]?.id ? Number(articleResult.rows[0].id) : null;

    // 5. Ensure the "Editorial" tag exists and link it
    if (articleId) {
      try {
        await db.execute({
          sql: `INSERT OR IGNORE INTO topics (name, slug, emoji) VALUES ('Editorial', 'editorial', '✍️')`,
          args: [],
        });
        const tagRow = await db.execute({ sql: "SELECT id FROM topics WHERE slug = 'editorial'", args: [] });
        const tagId = tagRow.rows[0]?.id ? Number(tagRow.rows[0].id) : null;
        if (tagId) {
          await db.execute({
            sql: "INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)",
            args: [articleId, tagId],
          });
        }
      } catch { /* tag creation is best-effort */ }
    }

    // 6. Update editorial status
    await db.execute({
      sql: `UPDATE editorials SET
        status = 'published', article_id = ?, published_path = ?,
        published_at = datetime('now'), image_data = NULL, updated_at = datetime('now')
        WHERE id = ?`,
      args: [articleId, editorialPath, id],
    });

    // 7. Post to Substack
    let substackUrl: string | undefined;
    if (Number(editorial.post_to_substack ?? 1) === 1) {
      try {
        const result = await postEditorialToSubstack(id);
        if (result.ok) {
          substackUrl = result.url;
          await db.execute({
            sql: "UPDATE editorials SET substack_posted_at = datetime('now') WHERE id = ?",
            args: [id],
          });
        }
      } catch (err) {
        console.error(`[editorial] Substack post failed for editorial ${id}:`, err);
      }
    }

    console.log(`[editorial] Published editorial ${id}: "${title}" → ${editorialPath}`);
    return { ok: true, editorialPath, cardPath, substackUrl };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[editorial] Failed to publish editorial ${id}:`, msg);
    return { ok: false, error: msg };
  }
}

// ─── Unpublish ──────────────────────────────────────────────────────────────

export async function unpublishEditorial(id: number): Promise<{ ok: boolean; error?: string }> {
  const result = await db.execute({ sql: "SELECT * FROM editorials WHERE id = ?", args: [id] });
  const editorial = result.rows[0];
  if (!editorial) return { ok: false, error: "Editorial not found" };
  if (editorial.status !== "published") return { ok: false, error: "Editorial is not published" };

  const slug = String(editorial.slug);
  const title = String(editorial.title_en ?? slug);
  const articleId = editorial.article_id ? Number(editorial.article_id) : null;
  const filenames = parseImageFilenames(editorial.image_filename);

  try {
    // 1. Delete editorial page from GitHub
    await deleteFromGitHub(`site/src/editorials/${slug}.md`, `Remove editorial: ${title}`);

    // 2. Delete homepage card — find the path from the linked article
    if (articleId) {
      const artResult = await db.execute({ sql: "SELECT published_path FROM articles WHERE id = ?", args: [articleId] });
      const publishedPath = artResult.rows[0]?.published_path ? String(artResult.rows[0].published_path) : null;
      if (publishedPath) {
        await deleteFromGitHub(publishedPath, `Remove editorial card: ${title}`);
      }
    }

    // 3. Delete images from GitHub
    for (const filename of filenames) {
      await deleteFromGitHub(`site/src/assets/editorials/${filename}`, `Remove editorial image: ${filename}`);
    }

    // 4. Clear editorial foreign key first, then delete the linked articles row
    await db.execute({
      sql: `UPDATE editorials SET
        status = 'ready', article_id = NULL, published_path = NULL,
        published_at = NULL, substack_posted_at = NULL, updated_at = datetime('now')
        WHERE id = ?`,
      args: [id],
    });

    if (articleId) {
      await db.execute({ sql: "DELETE FROM article_tags WHERE article_id = ?", args: [articleId] });
      await db.execute({ sql: "DELETE FROM articles WHERE id = ?", args: [articleId] });
    }

    console.log(`[editorial] Unpublished editorial ${id}: "${title}"`);
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[editorial] Failed to unpublish editorial ${id}:`, msg);
    return { ok: false, error: msg };
  }
}

// ─── Image commit helper ─────────────────────────────────────────────────────

async function commitImageToGitHub(path: string, base64Data: string, message: string) {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;
  const GITHUB_REPO = process.env.GITHUB_REPO!;
  const GITHUB_BRANCH = process.env.GITHUB_BRANCH ?? "main";

  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`;
  const headers = { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github+json" };

  let sha: string | undefined;
  const existing = await fetch(url, { headers });
  if (existing.ok) sha = (await existing.json()).sha;

  const body: Record<string, unknown> = { message, content: base64Data, branch: GITHUB_BRANCH };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`GitHub API error ${res.status}: ${await res.text()}`);
}
