/**
 * OPML import / export for Sources.
 *
 * GET  → returns an OPML 2.0 document containing every source, grouped into
 *        outline folders by language (English / Dutch / French). Website-only
 *        sources are included without an xmlUrl so the export is loss-less
 *        on round-trip. Our own extensions (`language`, `isActive`) are
 *        preserved as custom outline attributes — generic OPML readers ignore
 *        them, but our import reads them back.
 *
 * POST → accepts an OPML document (as text/xml, application/xml, or plain
 *        text body) and inserts any new feeds. Duplicates (matched on either
 *        the website URL or the RSS feed URL) are SKIPPED — never overwritten —
 *        and returned in `skippedDuplicates` so the UI can flag them for the
 *        user to verify manually.
 */

import { NextRequest } from "next/server";
import db from "@/lib/db";
import { exportSources } from "@/lib/export-sources";

type SourceRow = {
  id: number;
  name: string;
  url: string;
  feed_url: string | null;
  type: "rss" | "website";
  language: string;
  active: number;
};

const LANG_LABELS: Record<string, string> = {
  en: "English",
  nl: "Dutch",
  fr: "French",
};

// ─── Export ──────────────────────────────────────────────────────────────────

function xmlEscapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildOpml(sources: SourceRow[]): string {
  const byLang = new Map<string, SourceRow[]>();
  for (const s of sources) {
    const lang = (s.language || "en").toLowerCase();
    const bucket = byLang.get(lang) ?? [];
    bucket.push(s);
    byLang.set(lang, bucket);
  }

  const orderedLangs = ["en", "nl", "fr", ...Array.from(byLang.keys()).filter((l) => !["en", "nl", "fr"].includes(l))];

  const folders: string[] = [];
  for (const lang of orderedLangs) {
    const items = byLang.get(lang);
    if (!items || items.length === 0) continue;
    const folderTitle = LANG_LABELS[lang] ?? lang.toUpperCase();
    const outlines = items.map((s) => {
      const attrs: string[] = [
        `type="${s.feed_url || s.type === "rss" ? "rss" : "link"}"`,
        `text="${xmlEscapeAttr(s.name)}"`,
        `title="${xmlEscapeAttr(s.name)}"`,
      ];
      if (s.feed_url) attrs.push(`xmlUrl="${xmlEscapeAttr(s.feed_url)}"`);
      if (s.url)      attrs.push(`htmlUrl="${xmlEscapeAttr(s.url)}"`);
      attrs.push(`language="${xmlEscapeAttr(lang)}"`);
      if (!s.active) attrs.push(`isActive="false"`);
      return `      <outline ${attrs.join(" ")} />`;
    }).join("\n");
    folders.push(
      `    <outline text="${xmlEscapeAttr(folderTitle)}" title="${xmlEscapeAttr(folderTitle)}">\n${outlines}\n    </outline>`
    );
  }

  const now = new Date().toUTCString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>Positron Today sources</title>
    <dateCreated>${now}</dateCreated>
  </head>
  <body>
${folders.join("\n")}
  </body>
</opml>
`;
}

export async function GET() {
  const result = await db.execute("SELECT * FROM sources ORDER BY language ASC, name ASC");
  const sources = result.rows as unknown as SourceRow[];
  const xml = buildOpml(sources);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(xml, {
    headers: {
      "Content-Type":        "text/x-opml; charset=utf-8",
      "Content-Disposition": `attachment; filename="positron-sources-${date}.opml"`,
    },
  });
}

// ─── Import ──────────────────────────────────────────────────────────────────

type ParsedOutline = {
  name: string;
  url: string | null;       // website URL (htmlUrl)
  feed_url: string | null;  // RSS URL (xmlUrl)
  language: string;
  type: "rss" | "website";
};

function normalizeLang(raw: string | null | undefined): string {
  if (!raw) return "";
  const v = raw.trim().toLowerCase();
  if (/^en/.test(v) || v === "english") return "en";
  if (/^nl/.test(v) || v === "dutch" || v === "nederlands") return "nl";
  if (/^fr/.test(v) || v === "french" || v === "français" || v === "francais") return "fr";
  return "";
}

function xmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([\da-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&"); // must come last
}

// Parse attributes from an outline tag's inside ("foo=\"bar\" baz='qux'"),
// returning a case-insensitive lookup.
function parseAttrs(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z_][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrString)) !== null) {
    const key = m[1].toLowerCase();
    const val = xmlUnescape(m[2] ?? m[3] ?? "");
    attrs[key] = val;
  }
  return attrs;
}

type OutlineToken =
  | { kind: "open";  attrs: Record<string, string> }
  | { kind: "self";  attrs: Record<string, string> }
  | { kind: "close" };

function tokenizeOutlines(xml: string): OutlineToken[] {
  // Match <outline ... /> or <outline ...> or </outline>.
  const re = /<\s*(\/)?outline\b([^>]*?)(\/)?\s*>/gi;
  const tokens: OutlineToken[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const closing    = m[1] === "/";
    const attrString = m[2] ?? "";
    const selfClose  = m[3] === "/";
    if (closing) tokens.push({ kind: "close" });
    else if (selfClose) tokens.push({ kind: "self", attrs: parseAttrs(attrString) });
    else tokens.push({ kind: "open", attrs: parseAttrs(attrString) });
  }
  return tokens;
}

function parseOpml(xml: string): ParsedOutline[] {
  const tokens = tokenizeOutlines(xml);
  const stack: Record<string, string>[] = []; // open folder outlines above the current token
  const out: ParsedOutline[] = [];

  // Resolve a language by walking up the current folder stack.
  const inheritedLang = (): string => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const a = stack[i];
      const byAttr = normalizeLang(a.language);
      if (byAttr) return byAttr;
      const byTitle = normalizeLang(a.title ?? a.text);
      if (byTitle) return byTitle;
    }
    return "";
  };

  const handle = (attrs: Record<string, string>) => {
    const feedUrl = (attrs.xmlurl ?? "").trim();
    const htmlUrl = (attrs.htmlurl ?? "").trim();
    if (!feedUrl && !htmlUrl) return; // folder-only outline, skip as feed entry
    const title = (attrs.title ?? attrs.text ?? "").trim();
    if (!title) return;
    const attrLang = normalizeLang(attrs.language);
    const lang = attrLang || inheritedLang() || "en";
    out.push({
      name:     title,
      url:      htmlUrl || feedUrl || null,
      feed_url: feedUrl || null,
      language: lang,
      type:     feedUrl ? "rss" : "website",
    });
  };

  for (const t of tokens) {
    if (t.kind === "self") {
      handle(t.attrs);
    } else if (t.kind === "open") {
      handle(t.attrs);
      stack.push(t.attrs);
    } else {
      stack.pop();
    }
  }

  return out;
}

export async function POST(request: NextRequest) {
  let xml: string;
  try {
    xml = await request.text();
  } catch {
    return Response.json({ error: "Failed to read request body" }, { status: 400 });
  }
  if (!xml || xml.trim().length === 0) {
    return Response.json({ error: "Empty OPML document" }, { status: 400 });
  }

  let outlines: ParsedOutline[];
  try {
    outlines = parseOpml(xml);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Could not parse OPML: ${message}` }, { status: 400 });
  }

  if (outlines.length === 0) {
    return Response.json({ error: "No feed entries found in OPML document" }, { status: 400 });
  }

  // Snapshot existing URLs once so duplicate checks don't hit the DB per row.
  const existingRows = await db.execute("SELECT id, name, url, feed_url FROM sources");
  const existingByUrl     = new Map<string, SourceRow>();
  const existingByFeedUrl = new Map<string, SourceRow>();
  for (const r of existingRows.rows as unknown as SourceRow[]) {
    if (r.url)      existingByUrl.set(r.url.toLowerCase(), r);
    if (r.feed_url) existingByFeedUrl.set(r.feed_url.toLowerCase(), r);
  }

  const imported: Array<{ name: string; url: string; feed_url: string | null; language: string }> = [];
  const skippedDuplicates: Array<{ name: string; url: string; feed_url: string | null; existingName: string; matchedOn: "url" | "feed_url" }> = [];
  const skippedInvalid: Array<{ name: string; reason: string }> = [];

  for (const o of outlines) {
    const url = (o.url ?? "").trim();
    if (!url) {
      skippedInvalid.push({ name: o.name, reason: "no URL" });
      continue;
    }

    const urlKey     = url.toLowerCase();
    const feedUrlKey = o.feed_url ? o.feed_url.toLowerCase() : "";
    const dupByUrl     = existingByUrl.get(urlKey);
    const dupByFeedUrl = feedUrlKey ? existingByFeedUrl.get(feedUrlKey) : undefined;
    const dup = dupByUrl ?? dupByFeedUrl;
    if (dup) {
      skippedDuplicates.push({
        name:         o.name,
        url,
        feed_url:     o.feed_url,
        existingName: dup.name,
        matchedOn:    dupByUrl ? "url" : "feed_url",
      });
      continue;
    }

    try {
      await db.execute({
        sql: "INSERT INTO sources (name, url, feed_url, type, language) VALUES (?, ?, ?, ?, ?)",
        args: [o.name, url, o.feed_url || null, o.type, o.language || "en"],
      });
      imported.push({ name: o.name, url, feed_url: o.feed_url, language: o.language });
      existingByUrl.set(urlKey, { id: 0, name: o.name, url, feed_url: o.feed_url, type: o.type, language: o.language, active: 1 });
      if (feedUrlKey) existingByFeedUrl.set(feedUrlKey, { id: 0, name: o.name, url, feed_url: o.feed_url, type: o.type, language: o.language, active: 1 });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Race condition fallback — UNIQUE constraint could still fire if the same URL
      // appears twice in the OPML file itself.
      if (message.includes("UNIQUE")) {
        skippedDuplicates.push({ name: o.name, url, feed_url: o.feed_url, existingName: o.name, matchedOn: "url" });
      } else {
        skippedInvalid.push({ name: o.name, reason: message });
      }
    }
  }

  if (imported.length > 0) {
    exportSources().catch((err) => console.error("[export-sources]", err));
  }

  return Response.json({
    ok: true,
    importedCount:         imported.length,
    skippedDuplicateCount: skippedDuplicates.length,
    skippedInvalidCount:   skippedInvalid.length,
    imported,
    skippedDuplicates,
    skippedInvalid,
  });
}
