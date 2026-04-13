/**
 * GET  /api/social-accounts/enabled  — returns the list of enabled account IDs
 * PUT  /api/social-accounts/enabled  — saves the list of enabled account IDs
 *
 * Stored in the settings table as key = "postforme_enabled_accounts",
 * value = JSON array of account IDs.
 */

import db from "@/lib/db";

const SETTINGS_KEY = "postforme_enabled_accounts";

export async function GET() {
  const result = await db.execute({
    sql:  "SELECT value FROM settings WHERE key = ?",
    args: [SETTINGS_KEY],
  });

  if (result.rows.length === 0) {
    return Response.json({ enabled: [] });
  }

  try {
    const enabled = JSON.parse(String(result.rows[0].value));
    return Response.json({ enabled });
  } catch {
    return Response.json({ enabled: [] });
  }
}

export async function PUT(request: Request) {
  const { enabled } = await request.json().catch(() => ({ enabled: [] }));

  if (!Array.isArray(enabled)) {
    return Response.json({ error: "enabled must be an array" }, { status: 400 });
  }

  await db.execute({
    sql:  "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
    args: [SETTINGS_KEY, JSON.stringify(enabled)],
  });

  return Response.json({ ok: true, enabled });
}
