// Reads a file as a list of lines, for the checks that report a line number.
import { readFileSync } from "node:fs";

/** The lines of a UTF-8 text file. The first line is index 0, so a finding reports index + 1. */
export function readLines(file: string): string[] {
  return readFileSync(file, "utf8").split("\n");
}
