import db from "@/lib/db";
import { getFilterProvider } from "@/lib/llm";
import { CATEGORY_PROMPT_LIST, CATEGORY_SLUGS } from "@/lib/rejection-categories";
import { exportRejections } from "@/lib/export-rejections";

async function classifyRejection(
  title: string,
  snippet: string,
  existingReason: string,
): Promise<{ reason: string; category: string }> {
  const provider = await getFilterProvider();

  const prompt = `You are categorising a news article that was already rejected from a positive-news site called "Positiviteiten".

Your job is two-fold:
1. Assign the single best category slug from the list below.
2. Write a 1-2 sentence explanation of why this story is negative or not uplifting (if the existing reason is already 1-2 sentences and accurate, you may reuse it).

Article title: ${title}
Snippet: ${snippet.slice(0, 400)}
Existing short reason: ${existingReason || "(none)"}

Reply with JSON only — no other text:
{"reason":"1-2 sentence explanation","category":"<slug>"}

Valid category slugs:
${CATEGORY_PROMPT_LIST}`;

  const result = await provider.classify(prompt);
  return {
    reason: result.reason || existingReason || "does not fit positive news criteria",
    category: result.category ?? "other-negative",
  };
}

export async function POST() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
        } catch { /* stream already closed */ }
      };

      try {
        // Fetch all articles missing a category
        const result = await db.execute(`
          SELECT id, title, snippet, rejection_reason
          FROM rejected_articles
          WHERE rejection_category IS NULL OR rejection_category = ''
          ORDER BY fetched_at DESC
        `);

        const rows = result.rows;
        send({ type: "start", total: rows.length });

        if (rows.length === 0) {
          send({ type: "done", processed: 0, message: "All articles already have categories." });
          controller.close();
          return;
        }

        let processed = 0;
        let errors = 0;

        for (const row of rows) {
          const id = Number(row.id);
          const title = String(row.title ?? "");
          const snippet = String(row.snippet ?? "");
          const existingReason = String(row.rejection_reason ?? "");

          try {
            const { reason, category } = await classifyRejection(title, snippet, existingReason);
            const safeCategory = CATEGORY_SLUGS.includes(category) ? category : "other-negative";

            await db.execute({
              sql: `UPDATE rejected_articles
                    SET rejection_category = ?, rejection_reason = ?
                    WHERE id = ?`,
              args: [safeCategory, reason, id],
            });

            processed++;
            send({ type: "progress", id, title, category: safeCategory, reason, processed, total: rows.length });
          } catch (err) {
            errors++;
            send({ type: "item_error", id, title, message: String(err) });
          }
        }

        send({ type: "done", processed, errors, total: rows.length });

        // Re-export rejection log with updated categories
        try {
          send({ type: "exporting" });
          const { exported } = await exportRejections();
          send({ type: "exported", count: exported });
        } catch (err) {
          send({ type: "export_error", message: String(err) });
        }
      } catch (err) {
        send({ type: "fatal", message: String(err) });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}
