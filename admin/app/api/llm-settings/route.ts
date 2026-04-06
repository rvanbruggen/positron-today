import { NextRequest } from "next/server";
import { getSettings, setSettings, type LLMSettings } from "@/lib/settings";

export async function GET() {
  try {
    const settings = await getSettings();
    return Response.json(settings);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json() as Partial<LLMSettings>;
    const allowed: (keyof LLMSettings)[] = [
      "filter_provider",
      "filter_model",
      "summarise_provider",
      "summarise_model",
      "ollama_base_url",
    ];
    const patch: Partial<LLMSettings> = {};
    for (const key of allowed) {
      if (key in body && typeof body[key] === "string") {
        (patch as Record<string, string>)[key] = body[key] as string;
      }
    }
    if (Object.keys(patch).length === 0) {
      return Response.json({ error: "No valid fields provided" }, { status: 400 });
    }
    await setSettings(patch);
    const updated = await getSettings();
    return Response.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
