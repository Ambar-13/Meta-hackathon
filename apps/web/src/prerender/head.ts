// The head lines of the public pages: the title, the description, the canonical address and every
// tag a link preview reads, Open Graph first and then X's card. The app shell (index.html) carries
// the start page's share tags with no address of its own, so a share page or a deep link still
// shows a preview; a prerendered page swaps them for its own.
import { HOME_STRUCTURED_DATA, ORIGIN_PLACEHOLDER, type PageHead } from "./pages.js";

// The share picture, as og.png is drawn: 1200 by 630, the size link previews expect. The ?v= number
// goes up whenever the picture changes, so LinkedIn, X and the rest fetch the new one instead of
// showing their cached copy; index.html carries the same address.
export const SHARE_IMAGE = {
  path: "/og.png?v=2",
  width: 1200,
  height: 630,
  type: "image/png",
  alt: "The next generation of social media, with context. Beside it, a sample chat asks whether Jun would join an early hardware startup, and Jun's Meety answers with Jun's own words as the source.",
} as const;

// Every tag a link preview reads, by its name or property; each page's head and the app shell carry
// all of them. A page's head also carries og:url and the canonical address, which the shell leaves
// out so a deep link keeps its own.
export const SHARE_TAG_KEYS = [
  "description",
  "og:type",
  "og:site_name",
  "og:locale",
  "og:title",
  "og:description",
  "og:image",
  "og:image:secure_url",
  "og:image:type",
  "og:image:width",
  "og:image:height",
  "og:image:alt",
  "twitter:card",
  "twitter:title",
  "twitter:description",
  "twitter:image",
  "twitter:image:alt",
] as const;

// The app shell's own share tags: every meta line whose key is the description or starts with og:
// or twitter:, with the line break before it.
const SHELL_SHARE_LINE =
  /\n?[ \t]*<meta (?:name|property)="(?:description|og:[^"]+|twitter:[^"]+)"[^>]*>/g;

// Text made safe inside a double-quoted attribute or an element.
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// One meta line.
function meta(attribute: "name" | "property", key: string, value: string): string {
  return `<meta ${attribute}="${key}" content="${escapeHtml(value)}" />`;
}

// The share lines a page and the app shell both carry: the words, the kind, the site, the language
// and the picture.
export function shareLines(words: { shareTitle: string; description: string }): string[] {
  const picture = `${ORIGIN_PLACEHOLDER}${SHARE_IMAGE.path}`;
  return [
    meta("name", "description", words.description),
    meta("property", "og:type", "website"),
    meta("property", "og:site_name", "Meety"),
    meta("property", "og:locale", "en_US"),
    meta("property", "og:title", words.shareTitle),
    meta("property", "og:description", words.description),
    meta("property", "og:image", picture),
    meta("property", "og:image:secure_url", picture),
    meta("property", "og:image:type", SHARE_IMAGE.type),
    meta("property", "og:image:width", String(SHARE_IMAGE.width)),
    meta("property", "og:image:height", String(SHARE_IMAGE.height)),
    meta("property", "og:image:alt", SHARE_IMAGE.alt),
    meta("name", "twitter:card", "summary_large_image"),
    meta("name", "twitter:title", words.shareTitle),
    meta("name", "twitter:description", words.description),
    meta("name", "twitter:image", picture),
    meta("name", "twitter:image:alt", SHARE_IMAGE.alt),
  ];
}

// The head of one page: the title, the canonical address and og:url, the share lines, and on the
// start page the structured data. The origin is the placeholder throughout.
export function headOf(page: PageHead): string {
  const url = `${ORIGIN_PLACEHOLDER}${page.path}`;
  const lines = [
    `<title>${escapeHtml(page.title)}</title>`,
    `<link rel="canonical" href="${url}" />`,
    meta("property", "og:url", url),
    ...shareLines(page),
  ];
  if (page.path === "/") {
    // JSON inside a script element: "<" is written as its escape, so a value could never end the
    // element early. The element is data, not a script, so the Content-Security-Policy does not apply.
    const json = JSON.stringify(HOME_STRUCTURED_DATA).replaceAll("<", "\\u003c");
    lines.push(`<script type="application/ld+json">${json}</script>`);
  }
  return lines.join("\n    ");
}

// The app shell without its own share tags, ready for a page's head.
export function withoutShellShareTags(shell: string): string {
  return shell.replace(SHELL_SHARE_LINE, "");
}
