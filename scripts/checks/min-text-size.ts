// Fails on text set under 13px in the web app's stylesheets (standing rule: anyone can read every
// word without zooming). Only px and rem sizes are read, with 1rem as 16px; em and % sizes follow
// their parent, and custom properties are not sizes until a rule uses them.
import { type Finding } from "./finding.js";
import { readLines } from "./read-lines.js";
import { walkFiles } from "./walk-files.js";

// The smallest text the app shows, in px.
const MIN_TEXT_PX = 13;
const PX_PER_REM = 16;
// A font-size declaration, or a font shorthand's size after its optional style and weight words.
const SIZE_DECLARATION =
  /(?:^|[\s;{])font(?:-size)?:\s*(?:(?:italic|oblique|normal|small-caps|bold|bolder|lighter|\d{3})\s+)*([\d.]+)(px|rem)\b/g;

/** Every line of a web stylesheet that sets text under 13px, with its file and line number. */
export function checkMinTextSize(root: string): Finding[] {
  const files = walkFiles(root, "apps/web/src", (name) => name.endsWith(".css"));
  return files.flatMap((file) =>
    readLines(file).flatMap((text, index) =>
      [...text.matchAll(SIZE_DECLARATION)]
        .map((match) => Number(match[1]) * (match[2] === "rem" ? PX_PER_REM : 1))
        .filter((px) => px < MIN_TEXT_PX)
        .map((px) => ({
          check: "min-text-size",
          file,
          line: index + 1,
          message: `text at ${String(px)}px; the smallest text is ${String(MIN_TEXT_PX)}px`,
        })),
    ),
  );
}
