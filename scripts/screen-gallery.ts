// Builds the screen gallery (apps/web/gallery.html) and saves a screenshot of every view at phone and laptop width.
// Each view gets <name>-390.png and <name>-1280.png (the first screen), plus -full.png when the page is taller than one screen.
// Usage: pnpm exec tsx scripts/screen-gallery.ts [--only home,card] [--out <folder>] [--scale 2] [--no-build]
// Needs Google Chrome; set CHROME_PATH when it is not in the usual macOS place.
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const CHROME = process.env["CHROME_PATH"] ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const WEB_DIR = resolve("apps/web");
const GALLERY_FILE = join(WEB_DIR, "dist-gallery", "gallery.html");
// The two widths every screen is checked at: a phone first, then a laptop.
const SIZES = [
  { width: 390, height: 844, isMobile: true },
  { width: 1280, height: 800, isMobile: false },
] as const;
// How long a view gets to load its fonts and stubbed data before the screenshot, in ms.
const SETTLE_MS = 2_200;
// The tallest full-page screenshot, in CSS pixels.
const FULL_MAX_PX = 7_000;

type Options = { only: string[]; out: string; scale: number; shouldBuild: boolean };
type CdpReply = { result?: Record<string, unknown>; error?: { message: string } };
type Cdp = { send: (method: string, params?: object, sessionId?: string) => Promise<CdpReply>; close: () => Promise<void> };

// Reads the command line flags.
function readOptions(argv: readonly string[]): Options {
  const valueOf = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const only = (valueOf("--only") ?? "").split(",").filter((part) => part !== "");
  const out = resolve(valueOf("--out") ?? join(tmpdir(), "meet-first-screens"));
  return { only, out, scale: Number(valueOf("--scale") ?? "1"), shouldBuild: !argv.includes("--no-build") };
}

// Waits for the given time.
function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

// Starts headless Chrome on a debugging port and connects to it over the DevTools protocol.
async function openChrome(port: number): Promise<Cdp> {
  const profile = join(tmpdir(), `meet-first-gallery-${String(port)}`);
  const args = ["--headless=new", `--remote-debugging-port=${String(port)}`, "--hide-scrollbars", "--disable-gpu", "--allow-file-access-from-files", `--user-data-dir=${profile}`, "about:blank"];
  const chrome = spawn(CHROME, args, { stdio: "ignore" });
  let socketUrl: string | undefined;
  for (let attempt = 0; attempt < 40 && socketUrl === undefined; attempt += 1) {
    try {
      const version = (await (await fetch(`http://127.0.0.1:${String(port)}/json/version`)).json()) as { webSocketDebuggerUrl: string };
      socketUrl = version.webSocketDebuggerUrl;
    } catch {
      await sleep(250);
    }
  }
  if (socketUrl === undefined) throw new Error("Chrome did not open its debugging port; set CHROME_PATH to your Chrome.");
  const socket = new WebSocket(socketUrl);
  await new Promise<void>((done) => {
    socket.addEventListener("open", () => {
      done();
    });
  });
  let nextId = 0;
  const waiting = new Map<number, (reply: CdpReply) => void>();
  socket.addEventListener("message", (event: MessageEvent<string>) => {
    const reply = JSON.parse(event.data) as CdpReply & { id?: number };
    if (reply.id !== undefined) waiting.get(reply.id)?.(reply);
  });
  const send = (method: string, params: object = {}, sessionId?: string): Promise<CdpReply> =>
    new Promise((done) => {
      nextId += 1;
      waiting.set(nextId, done);
      socket.send(JSON.stringify({ id: nextId, method, params, sessionId }));
    });
  const close = async (): Promise<void> => {
    socket.close();
    const exited = new Promise((done) => chrome.once("exit", done));
    chrome.kill();
    await exited;
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  return { send, close };
}

// One open tab: its id, to close it, and its session, to talk to it.
type Tab = { targetId: string; sessionId: string };

// What to open: the page, the screen size, and the pixel ratio of the screenshot.
type PageRequest = { url: string; size: (typeof SIZES)[number]; scale: number };

// Opens a page in a new tab at one size and returns the tab once it has settled.
async function openPage(cdp: Cdp, page: PageRequest): Promise<Tab> {
  const { url, size, scale } = page;
  const target = await cdp.send("Target.createTarget", { url: "about:blank" });
  const targetId = String(target.result?.["targetId"]);
  const attached = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const sessionId = String(attached.result?.["sessionId"]);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: size.width, height: size.height, deviceScaleFactor: scale, mobile: size.isMobile }, sessionId);
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Page.navigate", { url }, sessionId);
  await sleep(SETTLE_MS);
  return { targetId, sessionId };
}

// Evaluates one expression in a tab and returns its value.
async function evaluate(cdp: Cdp, sessionId: string, expression: string): Promise<unknown> {
  const reply = await cdp.send("Runtime.evaluate", { expression, returnByValue: true }, sessionId);
  return (reply.result?.["result"] as { value?: unknown } | undefined)?.value;
}

// Saves one screenshot of the tab as it is now.
async function capture(cdp: Cdp, sessionId: string, file: string): Promise<void> {
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" }, sessionId);
  writeFileSync(file, Buffer.from(String(shot.result?.["data"]), "base64"));
}

// Shoots one view at one size: the first screen, then the whole page when it is taller than a screen.
async function shootView(cdp: Cdp, shot: { name: string; size: (typeof SIZES)[number] }, options: Options): Promise<string[]> {
  const { name, size } = shot;
  const { targetId, sessionId } = await openPage(cdp, { url: `file://${GALLERY_FILE}?view=${name}`, size, scale: options.scale });
  const first = join(options.out, `${name}-${String(size.width)}.png`);
  await capture(cdp, sessionId, first);
  const files = [first];
  const height = Number(await evaluate(cdp, sessionId, "document.documentElement.scrollHeight"));
  if (height > size.height + 40) {
    const full = Math.min(height, FULL_MAX_PX);
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: size.width, height: full, deviceScaleFactor: options.scale, mobile: size.isMobile }, sessionId);
    await sleep(600);
    const fullFile = join(options.out, `${name}-${String(size.width)}-full.png`);
    await capture(cdp, sessionId, fullFile);
    files.push(fullFile);
  }
  await cdp.send("Target.closeTarget", { targetId });
  return files;
}

// Builds the gallery, reads its view names, and shoots the chosen views at both sizes.
async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  if (options.shouldBuild) execFileSync("pnpm", ["--filter", "@meet-first/web", "exec", "vite", "build", "--config", "vite.gallery.config.ts"], { stdio: "inherit" });
  mkdirSync(options.out, { recursive: true });
  const cdp = await openChrome(9400 + Math.floor(Math.random() * 400));
  try {
    const index = await openPage(cdp, { url: `file://${GALLERY_FILE}`, size: SIZES[1], scale: 1 });
    const names = (await evaluate(cdp, index.sessionId, "[...document.querySelectorAll('a[data-name]')].map((a) => a.dataset.name)")) as string[];
    const chosen = names.filter((name) => options.only.length === 0 || options.only.some((prefix) => name.startsWith(prefix)));
    for (const name of chosen) {
      for (const size of SIZES) console.log((await shootView(cdp, { name, size }, options)).join("\n"));
    }
  } finally {
    await cdp.close();
  }
}

await main();
