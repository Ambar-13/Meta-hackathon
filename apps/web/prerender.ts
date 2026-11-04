// Writes the public pages with their words already in the HTML, after the two builds: reads the
// app shell vite build wrote (dist/index.html), renders each public page with
// dist-prerender/entry-server.js, puts the page inside <div id="root"> and its head lines in place
// of the bare title, and writes dist/prerendered/<file>. The api serves those files at their paths
// and swaps __APP_ORIGIN__ for its origin. Runs last in pnpm --filter @meet-first/web build.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PUBLIC_PAGES } from "@meet-first/contracts";
import {
  HOME_STRUCTURED_DATA,
  ORIGIN_PLACEHOLDER,
  PAGE_HEADS,
  type PageHead,
} from "./src/prerender/pages.js";

// Where the shell is, where the server bundle is, and where the pages go.
const SHELL_FILE = resolve("dist/index.html");
const SERVER_BUNDLE = resolve("dist-prerender/entry-server.js");
const OUT_DIR = resolve("dist/prerendered");
// The two marks in the shell that the page's head and body replace.
const TITLE_MARK = "<title>Meety</title>";
const ROOT_MARK = '<div id="root"></div>';
// The share picture's size, as og.png is drawn (1200 by 630, the size link previews expect).
const SHARE_IMAGE = { path: "/og.png", width: 1200, height: 630 } as const;

// The server bundle's one export.
type ServerBundle = { renderPath: (path: string) => Promise<string> };

// Text made safe inside a double-quoted attribute or an element.
function escapeHtml(text: string): string {
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

// The share picture's lines, for the pages that carry it.
function shareImageLines(origin: string): string[] {
  return [
    meta("property", "og:image", `${origin}${SHARE_IMAGE.path}`),
    meta("property", "og:image:width", String(SHARE_IMAGE.width)),
    meta("property", "og:image:height", String(SHARE_IMAGE.height)),
    meta(
      "property",
      "og:image:alt",
      "Your Meety meets theirs first, with two name tags, Mira and Jonah, on a sky",
    ),
    meta("name", "twitter:card", "summary_large_image"),
    meta("name", "twitter:image", `${origin}${SHARE_IMAGE.path}`),
  ];
}

// The head of one page: the title, the description, the canonical address, the link preview
// lines, and on the start page the structured data. The origin is the placeholder throughout.
function headOf(page: PageHead): string {
  const url = `${ORIGIN_PLACEHOLDER}${page.path}`;
  const lines = [
    `<title>${escapeHtml(page.title)}</title>`,
    meta("name", "description", page.description),
    `<link rel="canonical" href="${url}" />`,
    meta("property", "og:type", "website"),
    meta("property", "og:site_name", "Meety"),
    meta("property", "og:title", page.shareTitle),
    meta("property", "og:description", page.description),
    meta("property", "og:url", url),
    meta("name", "twitter:title", page.shareTitle),
    meta("name", "twitter:description", page.description),
  ];
  if (page.hasShareImage) lines.push(...shareImageLines(ORIGIN_PLACEHOLDER));
  if (page.path === "/") {
    // JSON inside a script element: "<" is written as its escape, so a value could never end the
    // element early. The element is data, not a script, so the Content-Security-Policy does not apply.
    const json = JSON.stringify(HOME_STRUCTURED_DATA).replaceAll("<", "\\u003c");
    lines.push(`<script type="application/ld+json">${json}</script>`);
  }
  return lines.join("\n    ");
}

// Renders one page and writes its file; throws when the render lacks the page's own words.
async function writePage(shell: string, bundle: ServerBundle, page: PageHead): Promise<string> {
  const entry = PUBLIC_PAGES.find((candidate) => candidate.path === page.path);
  if (entry === undefined) throw new Error(`${page.path} is not in PUBLIC_PAGES.`);
  const body = await bundle.renderPath(page.path);
  if (!body.includes(page.mustContain)) {
    throw new Error(`The render of ${page.path} lacks "${page.mustContain}".`);
  }
  const html = shell
    .replace(TITLE_MARK, headOf(page))
    .replace(ROOT_MARK, `<div id="root">${body}</div>`);
  await writeFile(join(OUT_DIR, entry.file), html);
  return entry.file;
}

// Reads the shell and the bundle, writes every page, and prints the files written.
async function main(): Promise<void> {
  const shell = await readFile(SHELL_FILE, "utf8");
  if (!shell.includes(TITLE_MARK) || !shell.includes(ROOT_MARK)) {
    throw new Error(`${SHELL_FILE} lacks the title or the root the pages replace.`);
  }
  const bundle = (await import(pathToFileURL(SERVER_BUNDLE).href)) as ServerBundle;
  await mkdir(OUT_DIR, { recursive: true });
  const files: string[] = [];
  for (const page of PAGE_HEADS) {
    files.push(await writePage(shell, bundle, page));
  }
  process.stdout.write(`prerendered ${files.join(", ")} in ${OUT_DIR}\n`);
}

await main();
