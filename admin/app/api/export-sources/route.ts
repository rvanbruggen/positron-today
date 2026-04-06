import { exportSources } from "@/lib/export-sources";

export async function POST() {
  try {
    const result = await exportSources();
    return Response.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
