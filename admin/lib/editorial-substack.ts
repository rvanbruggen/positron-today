import db from "@/lib/db";

const SITE_BASE = "https://positron.today";
const PUBLICATION_URL = "https://positrontoday.substack.com";

export interface EditorialSubstackResult {
  ok: boolean;
  error?: string;
  url?: string;
}

export interface EditorialImageData {
  filename: string;
  base64: string;
}

async function uploadImageToSubstack(
  base64Data: string,
  filename: string,
  cookie: string,
): Promise<string | null> {
  try {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "png";
    const mimeMap: Record<string, string> = {
      svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg",
      jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
    };
    const mime = mimeMap[ext] ?? "image/png";
    const buffer = Buffer.from(base64Data, "base64");

    const formData = new FormData();
    formData.append("image", new Blob([buffer], { type: mime }), filename);

    const res = await fetch(`${PUBLICATION_URL}/api/v1/image`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: formData,
    });

    if (!res.ok) {
      console.warn(`[editorial-substack] Image upload failed (${res.status}) for ${filename}`);
      return null;
    }

    const data = await res.json();
    return data.url ?? null;
  } catch (err) {
    console.warn(`[editorial-substack] Image upload error for ${filename}:`, err);
    return null;
  }
}

interface ProsemirrorNode {
  type: string;
  content?: ProsemirrorNode[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  attrs?: Record<string, unknown>;
}

function markdownToProsemirror(markdown: string): ProsemirrorNode {
  const lines = markdown.split("\n");
  const content: ProsemirrorNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line — skip
    if (!line.trim()) { i++; continue; }

    // Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      content.push({
        type: "heading",
        attrs: { level },
        content: parseInline(headingMatch[2]),
      });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      content.push({ type: "horizontal_rule" });
      i++;
      continue;
    }

    // Image
    const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (imgMatch) {
      content.push({
        type: "captionedImage",
        attrs: { src: imgMatch[2], alt: imgMatch[1] },
      });
      i++;
      continue;
    }

    // Unordered list
    if (/^[-*]\s/.test(line)) {
      const items: ProsemirrorNode[] = [];
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        items.push({
          type: "listItem",
          content: [{ type: "paragraph", content: parseInline(lines[i].replace(/^[-*]\s+/, "")) }],
        });
        i++;
      }
      content.push({ type: "bullet_list", content: items });
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items: ProsemirrorNode[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push({
          type: "listItem",
          content: [{ type: "paragraph", content: parseInline(lines[i].replace(/^\d+\.\s+/, "")) }],
        });
        i++;
      }
      content.push({ type: "ordered_list", content: items });
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      content.push({
        type: "blockquote",
        content: [{ type: "paragraph", content: parseInline(quoteLines.join(" ")) }],
      });
      continue;
    }

    // Regular paragraph — accumulate consecutive non-blank lines
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^#{1,3}\s/.test(lines[i]) && !/^---+$/.test(lines[i].trim()) && !/^\*\*\*+$/.test(lines[i].trim())) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      content.push({
        type: "paragraph",
        content: parseInline(paraLines.join(" ")),
      });
    }
  }

  return { type: "doc", content };
}

function parseInline(text: string): ProsemirrorNode[] {
  const nodes: ProsemirrorNode[] = [];
  // Pattern matches: **bold**, *italic*, [link text](url), plain text
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: "text", text: text.slice(lastIndex, match.index) });
    }

    if (match[2]) {
      // Bold
      nodes.push({ type: "text", text: match[2], marks: [{ type: "strong" }] });
    } else if (match[3]) {
      // Italic
      nodes.push({ type: "text", text: match[3], marks: [{ type: "em" }] });
    } else if (match[4] && match[5]) {
      // Link
      nodes.push({
        type: "text",
        text: match[4],
        marks: [{ type: "link", attrs: { href: match[5] } }],
      });
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push({ type: "text", text: text.slice(lastIndex) });
  }

  return nodes.length > 0 ? nodes : [{ type: "text", text: text || " " }];
}

export async function postEditorialToSubstack(
  editorialId: number,
  images?: EditorialImageData[],
): Promise<EditorialSubstackResult> {
  const sid = process.env.SUBSTACK_SID;
  if (!sid) return { ok: false, error: "SUBSTACK_SID is not set" };

  const result = await db.execute({
    sql: "SELECT * FROM editorials WHERE id = ?",
    args: [editorialId],
  });
  const editorial = result.rows[0];
  if (!editorial) return { ok: false, error: `Editorial ${editorialId} not found` };

  const title = String(editorial.title_en ?? "Untitled");
  const contentEn = String(editorial.content_en ?? "");
  if (!contentEn.trim()) return { ok: false, error: "No English content to post" };

  const slug = String(editorial.slug ?? "");
  const siteUrl = `${SITE_BASE}/editorials/${slug}/`;
  const cookie = `substack.sid=${sid}`;

  // Upload images to Substack CDN and build a filename→CDN URL map
  const cdnMap = new Map<string, string>();
  if (images && images.length > 0) {
    for (const img of images) {
      const cdnUrl = await uploadImageToSubstack(img.base64, img.filename, cookie);
      if (cdnUrl) {
        cdnMap.set(img.filename, cdnUrl);
        console.log(`[editorial-substack] Uploaded ${img.filename} → ${cdnUrl}`);
      }
    }
  }

  // Rewrite bare image filenames to CDN URLs (or fall back to public site URLs)
  const contentWithImages = contentEn.replace(
    /!\[([^\]]*)\]\(([^/)][^)]*)\)/g,
    (_m, alt, src) => {
      const cdnUrl = cdnMap.get(src);
      if (cdnUrl) return `![${alt}](${cdnUrl})`;
      return `![${alt}](${SITE_BASE}/assets/editorials/${src})`;
    },
  );

  // Build Prosemirror doc from markdown + append site link
  const bodyDoc = markdownToProsemirror(contentWithImages);
  bodyDoc.content!.push(
    { type: "horizontal_rule" },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          marks: [{ type: "link", attrs: { href: siteUrl } }],
          text: "Read this editorial on Positron.today ↗",
        },
      ],
    },
  );

  const subtitle = "An editorial from Positron Today";
  // Use the CDN URL for the cover image if available
  let coverImageUrl: string | null = null;
  if (editorial.image_filename) {
    let firstImage: string | null = null;
    try {
      const arr = JSON.parse(String(editorial.image_filename));
      firstImage = Array.isArray(arr) && arr.length > 0 ? arr[0] : String(editorial.image_filename);
    } catch { firstImage = String(editorial.image_filename); }
    if (firstImage) {
      coverImageUrl = cdnMap.get(firstImage) ?? `${SITE_BASE}/assets/editorials/${firstImage}`;
    }
  }

  try {
    // Get author user ID
    const archiveRes = await fetch(`${PUBLICATION_URL}/api/v1/archive?limit=1`, {
      headers: { Cookie: cookie },
    });
    if (!archiveRes.ok) throw new Error(`Failed to fetch Substack archive (${archiveRes.status})`);
    const archive = await archiveRes.json();
    const userId = archive?.[0]?.publishedBylines?.[0]?.id as number | undefined;
    if (!userId) throw new Error("Could not determine Substack author ID from existing posts");

    const draftPayload: Record<string, unknown> = {
      draft_title: title,
      draft_subtitle: subtitle,
      draft_body: JSON.stringify(bodyDoc),
      draft_bylines: [{ id: userId, is_guest: false }],
      type: "newsletter",
    };
    if (coverImageUrl) draftPayload.cover_image = coverImageUrl;

    const draftRes = await fetch(`${PUBLICATION_URL}/api/v1/drafts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(draftPayload),
    });

    if (!draftRes.ok) {
      const text = await draftRes.text();
      throw new Error(`Failed to create Substack draft (${draftRes.status}): ${text}`);
    }

    const createdDraft = await draftRes.json();
    const draftId = createdDraft.id as number;

    const pubRes = await fetch(`${PUBLICATION_URL}/api/v1/drafts/${draftId}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({}),
    });

    if (!pubRes.ok) {
      const text = await pubRes.text();
      throw new Error(`Failed to publish Substack draft ${draftId} (${pubRes.status}): ${text}`);
    }

    const published = await pubRes.json();
    const url = published.canonical_url ?? `${PUBLICATION_URL}/p/${createdDraft.slug ?? draftId}`;

    console.log(`[editorial-substack] Posted editorial ${editorialId}: "${title}" → ${url}`);
    return { ok: true, url };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[editorial-substack] Failed to post editorial ${editorialId}:`, msg);
    return { ok: false, error: msg };
  }
}
