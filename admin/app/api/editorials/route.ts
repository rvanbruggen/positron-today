import { NextRequest } from "next/server";
import db from "@/lib/db";
import { slugify } from "@/lib/publish-core";

export async function GET() {
  const result = await db.execute(
    "SELECT id, slug, status, source_language, title_en, title_nl, title_fr, summary_en, article_emoji, image_filename, post_to_substack, substack_posted_at, publish_date, published_at, created_at, updated_at FROM editorials ORDER BY created_at DESC"
  );
  return Response.json(result.rows);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { content, source_language, title, images } = body;

  if (!content || !content.trim()) {
    return Response.json({ error: "content is required" }, { status: 400 });
  }

  const lang = source_language || "en";
  if (!["en", "nl", "fr"].includes(lang)) {
    return Response.json({ error: "source_language must be en, nl, or fr" }, { status: 400 });
  }

  // Extract title from first heading if not provided
  const extractedTitle = title || content.match(/^#\s+(.+)/m)?.[1] || "Untitled editorial";
  const slug = slugify(extractedTitle);

  const contentField = `content_${lang}`;
  const titleField = `title_${lang}`;

  // images is an array of {filename, data} objects; store as JSON
  const imageArr: { filename: string; data: string }[] = Array.isArray(images) ? images : [];
  const imageFilenames = imageArr.length > 0 ? JSON.stringify(imageArr.map(i => i.filename)) : null;
  const imageDatas = imageArr.length > 0 ? JSON.stringify(imageArr.map(i => i.data)) : null;

  try {
    const result = await db.execute({
      sql: `INSERT INTO editorials (slug, source_language, ${contentField}, ${titleField}, image_filename, image_data)
            VALUES (?, ?, ?, ?, ?, ?)
            RETURNING *`,
      args: [slug, lang, content, extractedTitle, imageFilenames, imageDatas],
    });
    return Response.json(result.rows[0], { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("UNIQUE")) {
      return Response.json({ error: "An editorial with this slug already exists" }, { status: 409 });
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
