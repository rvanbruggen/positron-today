import { NextRequest } from "next/server";
import db from "@/lib/db";
import Anthropic from "@anthropic-ai/sdk";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

const anthropic = new Anthropic();

async function fetchArticleText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Positiviteiten/1.0)" },
      signal: AbortSignal.timeout(10000),
    });
    const html = await res.text();
    const dom = new JSDOM(html, { url });
    const article = new Readability(dom.window.document).parse();
    return article?.textContent?.slice(0, 4000) ?? "";
  } catch {
    return "";
  }
}

async function summariseAndTranslate(
  sourceText: string,
  sourceUrl: string,
  sourceName: string,
  rawTitle: string | null = null,
): Promise<{
  title_nl: string; title_fr: string; title_en: string;
  summary_nl: string; summary_fr: string; summary_en: string;
}> {
  const STYLE = `You write in the voice of Rik Van Bruggen - a curious, enthusiastic Belgian who thinks out loud.
Key rules:
- Warm, direct, conversational. Never stiff or corporate.
- Use "I" naturally. Show genuine enthusiasm where it fits.
- Use casual connectives: "So:", "Now,", "Which brings me to...", "And here's the thing."
- Use a dash "-" never an em-dash "—".
- Titles: capitalise only the first word, everything else lowercase.
- Keep summaries to 3-5 sentences. No bullet lists. No sign-off needed (this is a card, not a full post).
- Always positive tone - this is a positive news site.`;

  const articleContext = sourceText
    ? `Article title: ${rawTitle ?? ""}\nArticle text:\n${sourceText}`
    : rawTitle
    ? `The full article text is not available (paywalled or JS-rendered). Use this title to write the summary card: "${rawTitle}". Do not mention that the text was unavailable.`
    : `No article text or title available. Write a short positive teaser based only on the source name and URL.`;

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: "You output only raw JSON. No prose, no markdown, no code fences, no explanation. Every response is a single JSON object.",
    messages: [
      {
        role: "user",
        content: `${STYLE}

Write a summary card for an article from ${sourceName} (${sourceUrl}).

${articleContext}

Output this exact JSON shape and nothing else:
{"title_nl":"...","title_fr":"...","title_en":"...","summary_nl":"...","summary_fr":"...","summary_en":"..."}`,
      },
    ],
  });

  const raw = (message.content[0] as { type: string; text: string }).text.trim();
  // Strip markdown fences if Claude added them despite instructions
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Unexpected Claude response: ${raw.slice(0, 120)}`);
  return JSON.parse(jsonMatch[0]);
}

export async function POST(request: NextRequest) {
  try {
    const { id } = await request.json();
    if (!id) return Response.json({ error: "id required" }, { status: 400 });

    const result = await db.execute({
      sql: `SELECT a.*, r.title as raw_title
            FROM articles a
            LEFT JOIN raw_articles r ON a.raw_article_id = r.id
            WHERE a.id = ?`,
      args: [id],
    });
    const article = result.rows[0];
    if (!article) return Response.json({ error: "Article not found" }, { status: 404 });

    // Fetch the article text
    const articleText = await fetchArticleText(String(article.source_url));
    const rawTitle = article.raw_title ? String(article.raw_title) : null;

    // Summarise and translate
    const summaries = await summariseAndTranslate(
      articleText,
      String(article.source_url),
      String(article.source_name),
      rawTitle,
    );

    // Save back to database
    await db.execute({
      sql: `UPDATE articles SET
              title_nl = ?, title_fr = ?, title_en = ?,
              summary_nl = ?, summary_fr = ?, summary_en = ?,
              status = 'scheduled'
            WHERE id = ?`,
      args: [
        summaries.title_nl, summaries.title_fr, summaries.title_en,
        summaries.summary_nl, summaries.summary_fr, summaries.summary_en,
        id,
      ],
    });

    return Response.json({ ok: true, ...summaries });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Summarise error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
