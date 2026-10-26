// Lint rules every workspace file follows (design-inputs/repo-structure-rules.md).
import tseslint from "typescript-eslint";
import vitest from "eslint-plugin-vitest";

// A local rule: every export has a plain comment on the line directly above it.
const exportCommentPlugin = {
  rules: {
    "above-every-export": {
      meta: {
        type: "problem",
        schema: [],
        messages: {
          missing: "Put a one-line plain comment above this export saying what it is for.",
        },
      },
      create(context) {
        const sourceCode = context.sourceCode;
        const reportIfBare = (node) => {
          const exportLine = node.loc.start.line;
          const hasCommentAbove = sourceCode
            .getAllComments()
            .some((comment) => comment.loc.end.line === exportLine - 1);
          if (!hasCommentAbove) context.report({ node, messageId: "missing" });
        };
        return {
          ExportNamedDeclaration: reportIfBare,
          ExportDefaultDeclaration: reportIfBare,
        };
      },
    },
  },
};

const sizeRules = {
  "max-lines-per-function": ["error", { max: 60, skipBlankLines: true, skipComments: true }],
  complexity: ["error", 10],
  "max-depth": ["error", 3],
  "max-params": ["error", 3],
  "no-nested-ternary": "error",
};

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/*.d.ts", "docs/evidence/**"] },
  ...tseslint.configs.strictTypeChecked.map((config) => ({ ...config, files: ["**/*.ts", "**/*.tsx"] })),
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: { parserOptions: { projectService: { allowDefaultProject: ["vitest.workspace.ts"], defaultProject: "tsconfig.base.json", maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 20 } } },
    rules: {
      ...sizeRules,
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/naming-convention": [
        "error",
        { selector: "default", format: ["camelCase"], leadingUnderscore: "forbid" },
        // Row types mirror SQL column names, so a type property may be snake_case (ledger.ts, packages/db types.ts).
        { selector: "typeProperty", format: ["camelCase", "snake_case"] },
        { selector: "variable", modifiers: ["const"], format: ["camelCase", "UPPER_CASE", "PascalCase"] },
        { selector: "typeLike", format: ["PascalCase"] },
        { selector: "enumMember", format: ["PascalCase"] },
        { selector: "objectLiteralProperty", format: null },
        { selector: "variable", types: ["boolean"], format: ["PascalCase"],
          prefix: ["is", "has", "can", "should", "was", "will", "did", "needs", "must"] },
      ],
      "no-restricted-imports": ["error", {
        paths: [{ name: "msw", message: "MSW is imported only under apps/web/src/testing (D74)." }],
        patterns: [{ group: ["**/packages/llm/**", "@meet-first/llm"], message: "Only apps/worker imports packages/llm (ARCHITECTURE.md section 8)." }],
      }],
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    ignores: ["**/*.test.ts", "**/*.test.tsx", "**/src/testing/**"],
    plugins: { "export-comment": exportCommentPlugin },
    rules: { "export-comment/above-every-export": "error" },
  },
  {
    files: ["apps/worker/**/*.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: ["apps/web/src/testing/**/*.ts", "apps/web/src/testing/**/*.tsx"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    plugins: { vitest },
    rules: { ...vitest.configs.recommended.rules, "vitest/expect-expect": "error", "max-lines-per-function": "off" },
  },
);
