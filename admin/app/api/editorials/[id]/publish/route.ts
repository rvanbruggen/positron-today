import { NextRequest } from "next/server";
import { publishEditorial } from "@/lib/editorial-core";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const result = await publishEditorial(Number(id));
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: 400 });
    }
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[api] Failed to publish editorial ${id}:`, message);
    return Response.json({ error: message }, { status: 500 });
  }
}
