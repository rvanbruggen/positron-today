import { postToSubstack } from "@/lib/substack";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { id } = await request.json();
  if (!id) return Response.json({ error: "Missing article id" }, { status: 400 });

  const result = await postToSubstack(Number(id));
  if (!result.ok) return Response.json({ error: result.error }, { status: 500 });
  return Response.json({ ok: true, url: result.url });
}
