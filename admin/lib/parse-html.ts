/**
 * HTML parsing utility using linkedom + @mozilla/readability.
 *
 * linkedom is a lightweight DOM implementation that works in serverless
 * environments (Vercel, Cloudflare Workers) — unlike jsdom which has
 * ESM-only transitive dependencies that crash on Vercel.
 */

import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";

/**
 * Parse an HTML string with Readability and return the extracted article.
 * This replaces the `new JSDOM(html, { url }) → new Readability(…).parse()` pattern.
 */
export function parseArticle(html: string, url: string) {
  const { document } = parseHTML(html);

  // Readability expects document.baseURI / document.documentURI to equal the
  // article's URL so it can resolve relative links.  linkedom doesn't set
  // these from a constructor option, so patch them directly.
  Object.defineProperty(document, "baseURI", { value: url, configurable: true });
  Object.defineProperty(document, "documentURI", { value: url, configurable: true });

  // Readability's type expects a full Document but linkedom's is close enough.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Readability(document as any).parse();
}
