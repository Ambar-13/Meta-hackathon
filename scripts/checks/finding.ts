// What a check found, and how `pnpm checks` prints it.
import { relative } from "node:path";

/**
 * One problem a check found. A finding with level "warning" is printed but does not fail `pnpm checks`.
 * Every other finding is an error. Only the style checks give warnings.
 */
export type Finding = {
  check: string;
  file: string;
  line: number;
  message: string;
  level?: "error" | "warning";
};

/**
 * Prints every finding and returns the exit code: 1 if any finding is an error, 0 if there are only warnings or none.
 */
export function reportFindings(findings: readonly Finding[], root: string): number {
  for (const finding of findings) {
    const prefix = finding.level === "warning" ? "warning " : "";
    console.error(
      `${prefix}${finding.check}: ${relative(root, finding.file)}:${String(finding.line)} ${finding.message}`,
    );
  }
  return findings.some((finding) => finding.level !== "warning") ? 1 : 0;
}
