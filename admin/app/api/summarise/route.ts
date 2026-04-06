import { NextRequest } from "next/server";
import db from "@/lib/db";
import { getSummariseProvider } from "@/lib/llm";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

async function fetchArticleText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Positiviteiten/1.0)" },
      signal: AbortSignal.timeout(10000),
    });
    const html = await res.text();

    const descMatch =
      html.match(/property="og:description"\s+content="([^"]{30,})"/i) ||
      html.match(/content="([^"]{30,})"\s+property="og:description"/i) ||
      html.match(/name="description"\s+content="([^"]{30,})"/i);
    const metaDesc = descMatch ? descMatch[1].trim() : "";

    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    const readabilityText = article?.textContent?.trim() ?? "";

    if (readabilityText.length > 200) return readabilityText.slice(0, 4000);
    return metaDesc.slice(0, 1000);
  } catch {
    return "";
  }
}

type TagRow = { id: number; name: string; emoji: string };

async function summariseAndTranslate(
  sourceText: string,
  sourceUrl: string,
  sourceName: string,
  rawTitle: string | null,
  availableTags: TagRow[],
): Promise<{
  title_nl: string; title_fr: string; title_en: string;
  summary_nl: string; summary_fr: string; summary_en: string;
  emoji: string;
  suggested_tags: string[];
}> {
  const STYLE = `You write in the voice of Rik Van Bruggen - a curious, enthusiastic Belgian who thinks out loud.
Key rules:
- Warm, direct, conversational. Never stiff or corporate.
- Use "I" naturally. Show genuine enthusiasm where it fits.
- Use casual connectives: "So:", "Now,", "Which brings me to...", "And here's the thing."
- Use a dash "-" never an em-dash "—".
- Titles: capitalise only the first word, everything else lowercase.
- Each summary MUST be exactly 4-5 sentences. Never fewer than 4. No bullet lists. No sign-off.
- Always positive tone - this is a positive news site.

LANGUAGE RULES — this is mandatory, never skip any language:
- title_en and summary_en: write in ENGLISH
- title_nl and summary_nl: write in DUTCH (Nederlands) - fully translate, do not copy the English
- title_fr and summary_fr: write in FRENCH (Français) - fully translate, do not copy the English
All six text fields are required. Never leave any field empty or copy text from another language field.`;

  const articleContext = sourceText
    ? `Article title: ${rawTitle ?? ""}\nArticle text:\n${sourceText}`
    : rawTitle
    ? `The full article text is not available (paywalled or JS-rendered). Use this title to write the summary card: "${rawTitle}". Do not mention that the text was unavailable. You MUST still output valid JSON — never explain that you cannot summarize.`
    : `No article text or title available. Write a short positive teaser based only on the source name and URL. You MUST still output valid JSON.`;

  const tagInstructions = availableTags.length > 0
    ? `Available tags: ${availableTags.map((t) => t.name).join(", ")}
Pick 0-3 tags from that list that best fit this article. Only use names from the list exactly as written. Return them as the "suggested_tags" array.`
    : `No tags are defined yet. Return an empty "suggested_tags" array.`;

  const provider = await getSummariseProvider();
  const raw = await provider.generate(
    `${STYLE}

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
}`,
    "You output only raw JSON. No prose, no markdown, no code fences, no explanation. Every response must be a single complete JSON object with all 8 fields filled in.",
    2400,
  );

  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Unexpected LLM response: ${raw.slice(0, 120)}`);
  const parsed = JSON.parse(jsonMatch[0]);

  // Ensure every field has a non-undefined string value so libsql never
  // receives undefined as a query argument (happens when the model omits a field).
  const str = (v: unknown, fallback = "") => (typeof v === "string" && v.trim() ? v.trim() : fallback);
  return {
    title_nl:       str(parsed.title_nl),
    title_fr:       str(parsed.title_fr),
    title_en:       str(parsed.title_en),
    summary_nl:     str(parsed.summary_nl),
    summary_fr:     str(parsed.summary_fr),
    summary_en:     str(parsed.summary_en),
    emoji:          str(parsed.emoji, "✨"),
    suggested_tags: Array.isArray(parsed.suggested_tags) ? parsed.suggested_tags : [],
  };
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

    const articleText = await fetchArticleText(String(article.source_url));
    const rawTitle = article.raw_title ? String(article.raw_title) : null;

    const summaries = await summariseAndTranslate(
      articleText,
      String(article.source_url),
      String(article.source_name),
      rawTitle,
      availableTags,
    );

    // Save summaries + emoji
    await db.execute({
      sql: `UPDATE articles SET
              title_nl = ?, title_fr = ?, title_en = ?,
              summary_nl = ?, summary_fr = ?, summary_en = ?,
              article_emoji = ?,
              status = 'scheduled'
            WHERE id = ?`,
      args: [
        summaries.title_nl, summaries.title_fr, summaries.title_en,
        summaries.summary_nl, summaries.summary_fr, summaries.summary_en,
        summaries.emoji,
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
