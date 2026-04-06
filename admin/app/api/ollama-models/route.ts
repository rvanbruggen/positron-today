import { getSettings } from "@/lib/settings";

export async function GET() {
  const settings = await getSettings();
  const baseUrl = settings.ollama_base_url.replace(/\/$/, "");

  try {
    const res = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return Response.json(
        { error: `Ollama responded with ${res.status}` },
        { status: 502 }
      );
    }
    const data = await res.json();
    // Ollama returns { models: [{ name, size, ... }] }
    const models: string[] = (data.models ?? []).map(
      (m: { name: string }) => m.name
    );
    return Response.json({ ok: true, models });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `Cannot reach Ollama at ${baseUrl}: ${message}` },
      { status: 503 }
    );
  }
}
