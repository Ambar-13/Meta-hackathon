// No file or folder is called utils, helpers, misc, common or manager.
// Those names hide what is inside. A file is named after the one idea it holds instead.
import { type Finding } from "./finding.js";
import { walkFiles } from "./walk-files.js";
import { levelFor, readPassedPaths, repositoryPath } from "./style-scope.js";

/** Names that say nothing about what a file holds. Matched without the extension and in any case. */
export const BANNED_NAMES: ReadonlySet<string> = new Set([
  "utils",
  "helpers",
  "misc",
  "common",
  "manager",
]);

const SEARCHED_FOLDERS = ["apps", "packages", "scripts", "tests"];

/** The banned name a repository path uses for a folder or for its file, if any. */
export function bannedNameIn(path: string): string | undefined {
  const parts = path.split("/");
  const fileName = parts.pop() ?? "";
  const baseName = (fileName.split(".")[0] ?? "").toLowerCase();
  if (BANNED_NAMES.has(baseName)) return fileName;
  return parts.find((folder) => BANNED_NAMES.has(folder.toLowerCase()));
}

/** Reports every file whose name, or whose folder's name, is on the banned list. */
export function checkBannedFileNames(root: string): Finding[] {
  const passedPaths = readPassedPaths(root);
  const files = SEARCHED_FOLDERS.flatMap((folder) => walkFiles(root, folder, () => true));
  const findings: Finding[] = [];
  for (const file of files) {
    const banned = bannedNameIn(repositoryPath(root, file));
    if (banned === undefined) continue;
    const message = `uses the name "${banned}", which hides what is inside; name the file or folder after its one idea`;
    findings.push({
      check: "banned-file-names",
      file,
      line: 1,
      message,
      level: levelFor(root, file, passedPaths),
    });
  }
  return findings;
}
