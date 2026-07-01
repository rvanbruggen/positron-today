import { NextRequest } from "next/server";
import { translateEditorial } from "@/lib/editorial-core";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const result = await translateEditorial(Number(id));
    return Response.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[api] Failed to translate editorial ${id}:`, message);
    return Response.json({ error: message }, { status: 500 });
  }
}
