import { NextRequest } from "next/server";
import db from "@/lib/db";

const EXT_TO_MIME: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; filename: string }> },
) {
  const { id, filename } = await params;
  const result = await db.execute({
    sql: "SELECT image_filename, image_data FROM editorials WHERE id = ?",
    args: [id],
  });
  const row = result.rows[0];
  if (!row || !row.image_filename || !row.image_data)
    return new Response("Not found", { status: 404 });

  let filenames: string[];
  let datas: string[];
  try {
    filenames = JSON.parse(String(row.image_filename));
    datas = JSON.parse(String(row.image_data));
  } catch {
    return new Response("Bad image data", { status: 500 });
  }

  const idx = filenames.indexOf(filename);
  if (idx === -1) return new Response("Image not found", { status: 404 });

  const base64 = datas[idx];
  const raw = base64.includes(",") ? base64.split(",")[1] : base64;
  const buffer = Buffer.from(raw, "base64");
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const contentType = EXT_TO_MIME[ext] ?? "application/octet-stream";

  return new Response(buffer, {
    headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=3600" },
  });
}
