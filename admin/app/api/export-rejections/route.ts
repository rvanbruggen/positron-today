import { exportRejections } from "@/lib/export-rejections";

export async function POST() {
  try {
    const result = await exportRejections();
    return Response.json({ ok: true, exported: result.exported });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
