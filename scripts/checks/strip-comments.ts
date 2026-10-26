// Removes comments from TypeScript source for the checks that read code as text.
// A comment may name a forbidden class or variable to explain why it is not used, so the
// composition-root and cell-routing checks read the code with its comments blanked.

/**
 * Blanks block and line comments but keeps every line break, so reported line numbers stay right.
 * A `//` inside a string such as "https://" is kept, because the character before it is a colon or a quote.
 */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, (whole, lead: string) => lead);
}
