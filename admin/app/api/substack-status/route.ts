import { checkSubstackHealth, countPendingSubstack, getLastSubstackFailure } from "@/lib/substack";

export const dynamic = "force-dynamic";

export async function GET() {
  const [health, pending, lastFailure] = await Promise.all([
    checkSubstackHealth(),
    countPendingSubstack(),
    getLastSubstackFailure(),
  ]);
  return Response.json({ ...health, pending, lastFailure });
}
