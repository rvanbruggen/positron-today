import { NextRequest } from "next/server";
import { summariseDraft } from "@/lib/summarise-core";

export async function POST(request: NextRequest) {
  try {
    const { id } = await request.json();
    if (!id) return Response.json({ error: "id required" }, { status: 400 });

    const result = await summariseDraft(Number(id));
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message === "Article not found") {
      return Response.json({ error: message }, { status: 404 });
    }
    console.error("Summarise error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
