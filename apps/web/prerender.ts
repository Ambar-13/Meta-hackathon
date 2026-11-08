// Writes the public pages with their words already in the HTML, after the two builds: reads the
// app shell vite build wrote (dist/index.html), renders each public page with
// dist-prerender/entry-server.js, puts the page inside <div id="root"> and its head lines in place
// of the bare title, and writes dist/prerendered/<file>. The api serves those files at their paths
// and swaps __APP_ORIGIN__ for its origin. Runs last in pnpm --filter @meet-first/web build.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PUBLIC_PAGES } from "@meet-first/contracts";
import { headOf, withoutShellShareTags } from "./src/prerender/head.js";
import { PAGE_HEADS, type PageHead } from "./src/prerender/pages.js";

// Where the shell is, where the server bundle is, and where the pages go.
const SHELL_FILE = resolve("dist/index.html");
const SERVER_BUNDLE = resolve("dist-prerender/entry-server.js");
const OUT_DIR = resolve("dist/prerendered");
// The two marks in the shell that the page's head and body replace.
const TITLE_MARK = "<title>Meety</title>";
const ROOT_MARK = '<div id="root"></div>';

// The server bundle's one export.
type ServerBundle = { renderPath: (path: string) => Promise<string> };

// Renders one page and writes its file; throws when the render lacks the page's own words.
async function writePage(shell: string, bundle: ServerBundle, page: PageHead): Promise<string> {
  const entry = PUBLIC_PAGES.find((candidate) => candidate.path === page.path);
  if (entry === undefined) throw new Error(`${page.path} is not in PUBLIC_PAGES.`);
  const body = await bundle.renderPath(page.path);
  if (!body.includes(page.mustContain)) {
    throw new Error(`The render of ${page.path} lacks "${page.mustContain}".`);
  }
  const html = withoutShellShareTags(shell)
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
