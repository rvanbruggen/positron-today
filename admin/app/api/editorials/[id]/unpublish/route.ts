import { NextRequest } from "next/server";
import { unpublishEditorial } from "@/lib/editorial-core";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await unpublishEditorial(Number(id));
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  return Response.json({ ok: true });
}
