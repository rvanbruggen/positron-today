import { NextRequest } from "next/server";
import db from "@/lib/db";
import { generateEditorialPageMarkdown, generateEditorialCardMarkdown } from "@/lib/editorial-core";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await db.execute({ sql: "SELECT * FROM editorials WHERE id = ?", args: [id] });
  const editorial = result.rows[0];
  if (!editorial) return Response.json({ error: "Not found" }, { status: 404 });

  const slug = String(editorial.slug);
  const dateStr = new Date().toISOString().slice(0, 10);

  const editorialMd = generateEditorialPageMarkdown(editorial as Record<string, unknown>);
  const cardMd = generateEditorialCardMarkdown(editorial as Record<string, unknown>);

  let imageFilenames: string[] = [];
  if (editorial.image_filename) {
    try {
      const arr = JSON.parse(String(editorial.image_filename));
      imageFilenames = Array.isArray(arr) ? arr : [String(editorial.image_filename)];
    } catch { imageFilenames = [String(editorial.image_filename)]; }
  }

  return Response.json({
    editorial: {
      path: `site/src/editorials/${slug}.md`,
      content: editorialMd,
    },
    card: {
      path: `site/src/posts/${dateStr}-editorial-${slug}.md`,
      content: cardMd,
    },
    images: imageFilenames.map(f => `site/src/assets/editorials/${f}`),
  });
}
