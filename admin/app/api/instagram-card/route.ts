import { NextRequest, NextResponse } from "next/server";
import db from "@/lib/db";
import { generateInstagramCardOg } from "@/lib/instagram-card-og";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const result = await db.execute({
    sql: `SELECT title_en, title_nl, article_emoji, source_name, image_url
          FROM articles WHERE id = ? AND status = 'published'`,
    args: [id],
  });

  const row = result.rows[0];
  if (!row) return NextResponse.json({ error: "Article not found" }, { status: 404 });

  const title    = String(row.title_en ?? row.title_nl ?? "");
  const emoji    = String(row.article_emoji ?? "✨");
  const source   = String(row.source_name ?? "");
  const imageUrl = row.image_url ? String(row.image_url) : null;

  try {
    const png  = await generateInstagramCardOg({ title, emoji, source, imageUrl });
    const slug = title.toLowerCase().replace(/[^\w]+/g, "-").slice(0, 50).replace(/-$/, "");

    return new NextResponse(new Uint8Array(png), {
      headers: {
        "Content-Type":        "image/png",
        "Content-Disposition": `attachment; filename="positron-${slug}.png"`,
      },
    });
  } catch (err: unknown) {
    const e = err as { stderr?: Buffer; message?: string };
    console.error("Instagram card generation failed:", e?.message);
    if (e?.stderr) console.error("stderr:", e.stderr.toString());
    return NextResponse.json({ error: "Card generation failed" }, { status: 500 });
  }
}
