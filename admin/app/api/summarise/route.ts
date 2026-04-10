import { NextRequest } from "next/server";
import db from "@/lib/db";
import { getSummariseProvider } from "@/lib/llm";
import { DEFAULT_SUMMARISE_STYLE } from "@/lib/prompts";
import { getSettings } from "@/lib/settings";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

async function fetchArticleContent(url: string): Promise<{ text: string; imageUrl: string | null }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PositronToday/1.0)" },
      signal: AbortSignal.timeout(10000),
    });
    const html = await res.text();

    // Extract og:image for card thumbnails
    const imgMatch =
      html.match(/property="og:image"\s+content="([^"]+)"/i) ||
      html.match(/content="([^"]+)"\s+property="og:image"/i);
    const imageUrl = imgMatch ? imgMatch[1].trim() : null;

    const descMatch =
      html.match(/property="og:description"\s+content="([^"]{30,})"/i) ||
      html.match(/content="([^"]{30,})"\s+property="og:description"/i) ||
      html.match(/name="description"\s+content="([^"]{30,})"/i);
    const metaDesc = descMatch ? descMatch[1].trim() : "";

    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    const readabilityText = article?.textContent?.trim() ?? "";

    const text = readabilityText.length > 200
      ? readabilityText.slice(0, 4000)
      : metaDesc.slice(0, 1000);

    return { text, imageUrl };
  } catch {
    return { text: "", imageUrl: null };
  }
}

type TagRow = { id: number; name: string; emoji: string };

// All six text fields must be non-empty for a summary to be accepted.
const REQUIRED_TRANSLATION_FIELDS = [
  "title_en", "title_nl", "title_fr",
  "summary_en", "summary_nl", "summary_fr",
] as const;

async function summariseAndTranslate(
  sourceText: string,
  sourceUrl: string,
  sourceName: string,
  rawTitle: string | null,
  availableTags: TagRow[],
  style: string,
): Promise<{
  title_nl: string; title_fr: string; title_en: string;
  summary_nl: string; summary_fr: string; summary_en: string;
  emoji: string;
  suggested_tags: string[];
}> {
  const STYLE = style;

  const articleContext = sourceText
    ? `Article title: ${rawTitle ?? ""}\nArticle text:\n${sourceText}`
    : rawTitle
    ? `The full article text is not available (paywalled or JS-rendered). Use this title to write the summary card: "${rawTitle}". Do not mention that the text was unavailable. You MUST still output valid JSON — never explain that you cannot summarize.`
    : `No article text or title available. Write a short positive teaser based only on the source name and URL. You MUST still output valid JSON.`;

  const tagInstructions = availableTags.length > 0
    ? `Available tags: ${availableTags.map((t) => t.name).join(", ")}
Pick 0-3 tags from that list that best fit this article. Only use names from the list exactly as written. Return them as the "suggested_tags" array.`
    : `No tags are defined yet. Return an empty "suggested_tags" array.`;

  const basePrompt = `${STYLE}

Write a summary card for an article from ${sourceName} (${sourceUrl}).

${articleContext}

Also pick a single emoji that best represents the mood or subject of this specific article.

${tagInstructions}

Output ONLY this exact JSON object and nothing else. All fields are required:
{
  "title_en": "Title in English",
  "title_nl": "Titel in het Nederlands",
  "title_fr": "Titre en français",
  "summary_en": "4-5 sentence summary written in English.",
  "summary_nl": "Samenvatting van 4-5 zinnen geschreven in het Nederlands.",
  "summary_fr": "Résumé de 4-5 phrases écrit en français.",
  "emoji": "🌟",
  "suggested_tags": []
}`;

  const systemPrompt = "You output only raw JSON. No prose, no markdown, no code fences, no explanation. Every response must be a single complete JSON object with all 8 fields filled in.";

  const str = (v: unknown, fallback = "") => (typeof v === "string" && v.trim() ? v.trim() : fallback);
  const MAX_ATTEMPTS = 3;
  const provider = await getSummariseProvider();
  let missingFields: string[] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // On retries, append a targeted reminder so the model knows exactly what it missed.
    const prompt = (attempt > 1 && missingFields.length > 0)
      ? `${basePrompt}\n\nRETRY ${attempt}/${MAX_ATTEMPTS}: Your previous response had these fields empty or missing: ${missingFields.join(", ")}. Every field MUST contain text in the correct language. Empty strings are not acceptable.`
      : basePrompt;

    const raw = await provider.generate(prompt, systemPrompt, 2400);
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      missingFields = ["(no JSON found in response)"];
      console.warn(`[summarise] attempt ${attempt}/${MAX_ATTEMPTS}: ${missingFields[0]}`);
      if (attempt === MAX_ATTEMPTS) throw new Error(`Unexpected LLM response: ${raw.slice(0, 120)}`);
      continue;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      missingFields = ["(JSON parse error)"];
      console.warn(`[summarise] attempt ${attempt}/${MAX_ATTEMPTS}: JSON parse failed`);
      if (attempt === MAX_ATTEMPTS) throw new Error(`LLM returned invalid JSON after ${MAX_ATTEMPTS} attempts`);
      continue;
    }

    const result = {
      title_nl:       str(parsed.title_nl),
      title_fr:       str(parsed.title_fr),
      title_en:       str(parsed.title_en),
      summary_nl:     str(parsed.summary_nl),
      summary_fr:     str(parsed.summary_fr),
      summary_en:     str(parsed.summary_en),
      emoji:          str(parsed.emoji, "✨"),
      suggested_tags: Array.isArray(parsed.suggested_tags) ? parsed.suggested_tags : [],
    };

    missingFields = REQUIRED_TRANSLATION_FIELDS.filter(f => !result[f]);

    if (missingFields.length === 0) return result;  // ✓ all fields present

    console.warn(`[summarise] attempt ${attempt}/${MAX_ATTEMPTS}: missing fields: ${missingFields.join(", ")}`);
    if (attempt === MAX_ATTEMPTS) {
      throw new Error(
        `LLM failed to provide all translations after ${MAX_ATTEMPTS} attempts. ` +
        `Missing: ${missingFields.join(", ")}`
      );
    }
  }

  // Unreachable — TypeScript needs this.
  throw new Error("Unreachable");
}

export async function POST(request: NextRequest) {
  try {
    const { id } = await request.json();
    if (!id) return Response.json({ error: "id required" }, { status: 400 });

    // Fetch article and all available tags in parallel
    const [articleResult, tagsResult] = await Promise.all([
      db.execute({
        sql: `SELECT a.*, r.title as raw_title
              FROM articles a
              LEFT JOIN raw_articles r ON a.raw_article_id = r.id
              WHERE a.id = ?`,
        args: [id],
      }),
      db.execute("SELECT id, name, emoji FROM topics ORDER BY name ASC"),
    ]);

    const article = articleResult.rows[0];
    if (!article) return Response.json({ error: "Article not found" }, { status: 404 });

    const availableTags: TagRow[] = tagsResult.rows.map((t) => ({
      id: Number(t.id),
      name: String(t.name),
      emoji: String(t.emoji),
    }));

    const { text: articleText, imageUrl } = await fetchArticleContent(String(article.source_url));
    const rawTitle = article.raw_title ? String(article.raw_title) : null;

    const settings = await getSettings();
    const style = settings.summarise_style_override || DEFAULT_SUMMARISE_STYLE;

    const summaries = await summariseAndTranslate(
      articleText,
      String(article.source_url),
      String(article.source_name),
      rawTitle,
      availableTags,
      style,
    );

    // Save summaries + emoji + og:image
    await db.execute({
      sql: `UPDATE articles SET
              title_nl = ?, title_fr = ?, title_en = ?,
              summary_nl = ?, summary_fr = ?, summary_en = ?,
              article_emoji = ?,
              image_url = ?,
              status = 'scheduled'
            WHERE id = ?`,
      args: [
        summaries.title_nl, summaries.title_fr, summaries.title_en,
        summaries.summary_nl, summaries.summary_fr, summaries.summary_en,
        summaries.emoji,
        imageUrl,
        id,
      ],
    });

    // Match Claude's suggested tag names against actual tags (case-insensitive)
    const tagNameMap = new Map(availableTags.map((t) => [t.name.toLowerCase(), t]));
    const matchedTags = summaries.suggested_tags
      .map((name) => tagNameMap.get(String(name).toLowerCase()))
      .filter((t): t is TagRow => t !== undefined);

    // Replace article's tags with the suggested set
    await db.execute({ sql: "DELETE FROM article_tags WHERE article_id = ?", args: [id] });
    for (const tag of matchedTags) {
      await db.execute({
        sql: "INSERT OR IGNORE INTO article_tags (article_id, tag_id) VALUES (?, ?)",
        args: [id, tag.id],
      });
    }

    return Response.json({ ok: true, ...summaries, matched_tags: matchedTags });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Summarise error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
