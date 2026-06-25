import { checkSubstackHealth } from "@/lib/substack";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await checkSubstackHealth();
  return Response.json(result);
}
