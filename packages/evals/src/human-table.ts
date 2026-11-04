// The human metrics: reads the private response files, one per real pair, and prints the table. Names are never read.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

// The answers of one side: the card, the unsupported lines, the worth of the brief, and the teammate question.
const SideAnswers = z
  .object({
    cardRepresentedYou: z.number().int().min(1).max(5),
    unsupportedLines: z.array(z.string()),
    surfacedWorthDiscussing: z.number().int().min(1).max(5),
    wouldUseBeforeChoosingTeammate: z.object({ answer: z.boolean(), why: z.string() }).strict(),
  })
  .strict();
// One response file. It holds sides only, never names, so an unknown key such as name is refused.
const HumanResponse = z
  .object({
    pairId: z.string(),
    askedAt: z.string(),
    outcomeDefinition: z.string(),
    knownCollaborators: z.boolean(),
    sides: z.object({ a: SideAnswers, b: SideAnswers }).strict(),
    frictionPoints: z.array(
      z.object({ text: z.string(), knownBeforeReveal: z.boolean() }).strict(),
    ),
  })
  .strict();
// The type of one response file, read from the schema above.
export type HumanResponse = z.infer<typeof HumanResponse>;
// The pair id of the example file, which sits in the folder for the record and is never counted.
const EXAMPLE_PAIR_ID = "example";

// The mean of a list of numbers, or zero for an empty list.
function mean(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

// Reads every response file in the folder. A file that does not match the schema is named in a warning and skipped.
async function readResponses(folder: string): Promise<HumanResponse[]> {
  const names = await readdir(folder).catch(() => []);
  const responses: HumanResponse[] = [];
  for (const name of names.filter((item) => item.endsWith(".json")).sort()) {
    const parsed = HumanResponse.safeParse(
      JSON.parse(await readFile(join(folder, name), "utf8")) as unknown,
    );
    if (!parsed.success) {
      console.warn(
        `human_response_invalid: ${name} does not match the form and is skipped. Remove any name or extra field from it.`,
      );
      continue;
    }
    if (parsed.data.pairId !== EXAMPLE_PAIR_ID) responses.push(parsed.data);
  }
  return responses;
}

// The table rows for the answers, in the order of the form.
function tableOf(responses: HumanResponse[]): string {
  const sides = responses.flatMap((response) => [response.sides.a, response.sides.b]);
  const people = sides.length;
  const frictions = responses.flatMap((response) => response.frictionPoints);
  const yes = sides.filter((side) => side.wouldUseBeforeChoosingTeammate.answer).length;
  const unsupported = sides.filter((side) => side.unsupportedLines.length > 0).length;
  const known = frictions.filter((friction) => friction.knownBeforeReveal).length;
  const collaborators = responses.filter((response) => response.knownCollaborators).length;
  return [
    "| Question | Mean | n |",
    "|---|---|---|",
    `| Did the card represent you? (1 to 5) | ${mean(sides.map((side) => side.cardRepresentedYou)).toFixed(1)} | ${String(people)} people |`,
    `| Did any brief line feel unsupported? | ${String(unsupported)} of ${String(people)} said yes | ${String(people)} people |`,
    `| Did the brief surface something worth discussing? (1 to 5) | ${mean(sides.map((side) => side.surfacedWorthDiscussing)).toFixed(1)} | ${String(people)} people |`,
    `| Would you use it before choosing a teammate? | ${String(yes)} yes, ${String(people - yes)} no | ${String(people)} people |`,
    `| Friction points known before the reveal | ${String(known)} of ${String(frictions.length)} | ${String(collaborators)} known-collaborator pairs |`,
  ].join("\n");
}

// Builds the human table from the response folder. Zero real responses prints the sentence and nothing else.
export async function buildHumanTable(
  responsesDir: string,
): Promise<{ table: string; count: number }> {
  const responses = await readResponses(responsesDir);
  if (responses.length === 0) return { table: "No real pairs yet.", count: 0 };
  return { table: tableOf(responses), count: responses.length };
}
