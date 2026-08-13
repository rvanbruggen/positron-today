import { computeAndStoreWeights, getStoredWeights } from "@/lib/source-confidence";

export async function GET() {
  try {
    const weights = await getStoredWeights();
    if (!weights) {
      return Response.json({ computed: false });
    }
    return Response.json({
      computed: true,
      computed_at: weights.computed_at,
      global_confidence: weights.global_confidence,
      source_count: Object.keys(weights.weights).length,
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST() {
  try {
    const result = await computeAndStoreWeights();
    return Response.json({
      ok: true,
      computed_at: result.computed_at,
      global_confidence: result.global_confidence,
      source_count: Object.keys(result.weights).length,
    });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
