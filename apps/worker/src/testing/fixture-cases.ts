import {
  CARD_INPUT_MAX_CHARS,
  CardBuildOutput,
  NamesPassOutput,
  type RecordedCall,
} from "@meet-first/contracts";
import { buildChatRequest, type LlmRequest } from "@meet-first/llm";
import { normQuote } from "@meet-first/receipts";
import type { z } from "zod";
import {
  cardCall,
  cardRegenerationCall,
  chunkTurnsForNames,
  eligibleTurns,
  namesPassCall,
  sampleTurns,
  verifyItems,
  type FailedItem,
  type ModelCall,
  type SampledTurn,
} from "../cards/index.js";

// One scrub_names fixture case: the person, the turns of the unfrozen source, and the reply of each chunk in order.
export type NamesFixtureCase = {
  name: string;
  displayName: string;
  affiliations: string[];
  turns: string[];
  replies: Array<z.infer<typeof NamesPassOutput>>;
  usage: RecordedCall["usage"];
};
// One build_card fixture case: the person, the turns of the frozen source, sensitive tags by turn index, opt-ins, the first reply and, when it has failures, the regeneration reply.
export type CardFixtureCase = {
  name: string;
  displayName: string;
  turns: string[];
  sensitive: Record<number, string[]>;
  optIn: string[];
  firstReply: unknown;
  regenerationReply: unknown;
  usage: RecordedCall["usage"];
  isReplyValid: boolean;
};
// One English card item from its row: kind, claim, turn label, quote.
export type EnglishItemRow = readonly [kind: string, claim: string, turnId: string, quote: string];

// One names case by name; an unknown name throws, so a typo fails the test at once.
export function namesCase(name: string): NamesFixtureCase {
  const found = NAMES_FIXTURE_CASES.find((item) => item.name === name);
  if (found === undefined) throw new Error(`no fixture case named ${name}`);
  return found;
}

// One card case by name; an unknown name throws.
export function cardCase(name: string): CardFixtureCase {
  const found = CARD_FIXTURE_CASES.find((item) => item.name === name);
  if (found === undefined) throw new Error(`no fixture case named ${name}`);
  return found;
}

// The uuid a fixture case gives turn i, so the fixture test and the job see the same sampled turns.
export function caseTurnId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

// The calls a names case makes, in order, built with the job's own functions.
export function namesCaseCalls(fixtureCase: NamesFixtureCase): ModelCall[] {
  const allowlist = [fixtureCase.displayName, ...fixtureCase.affiliations].map((entry) =>
    entry.replace(/\s+/g, " ").trim(),
  );
  return chunkTurnsForNames(
    fixtureCase.turns.map((text, index) => ({ turnIndex: index, text })),
  ).map((chunk) => namesPassCall({ allowlist, chunkText: chunk.text }));
}

// The sampled turns of a card case, as the job builds them from its rows (sections 4.14 and 4.15).
export function cardCaseTurns(fixtureCase: CardFixtureCase): SampledTurn[] {
  const rows = fixtureCase.turns.map((text, index) => ({
    id: caseTurnId(index),
    turn_index: index,
    text,
    norm_text: normQuote(text),
    sensitive_categories: fixtureCase.sensitive[index] ?? [],
  }));
  const sampled = eligibleTurns(rows, fixtureCase.optIn).map((row) => ({
    id: row.id,
    turnIndex: row.turn_index,
    text: row.text,
    normText: row.norm_text,
    isSensitive: row.sensitive_categories.length > 0,
  }));
  return sampleTurns(sampled, CARD_INPUT_MAX_CHARS);
}

// The calls a card case makes: the first call and, when the first reply has failures, the regeneration (sections 4.15 and 4.16).
export function cardCaseCalls(fixtureCase: CardFixtureCase): ModelCall[] {
  const turns = cardCaseTurns(fixtureCase);
  const first = cardCall(turns);
  if (fixtureCase.regenerationReply === null) return [first];
  const turnsByIndex = new Map(turns.map((turn) => [turn.turnIndex, turn]));
  const failures = verifyItems(CardBuildOutput.parse(fixtureCase.firstReply).items, turnsByIndex, [
    first.messages[0]?.content ?? "",
  ]).filter((check): check is FailedItem => !check.ok);
  return [first, cardRegenerationCall(first, JSON.stringify(fixtureCase.firstReply), failures)];
}

// The LlmRequest of one call, its body built as the client builds it, so its hash names the fixture file.
export function fixtureRequest(call: ModelCall): LlmRequest {
  return {
    callSite: call.callSite,
    promptVersion: call.promptVersion,
    body: buildChatRequest({
      callSite: call.callSite,
      messages: call.messages,
      schema: call.schema,
      stream: false,
    }),
  };
}

// The response object of a non-streamed fixture whose reply text is the compact JSON of the output.
export function replyResponse(output: unknown): Record<string, unknown> {
  return {
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: JSON.stringify(output) },
        finish_reason: "stop",
      },
    ],
  };
}

// A text of one sentence repeated after a prefix, cut at the last space at or before the length.
export function longText(prefix: string, length: number): string {
  const sentence = " I keep my mornings free for deep work and answer messages after lunch.";
  let text = prefix;
  while (text.length < length) text += sentence;
  return text.slice(0, text.lastIndexOf(" ", length));
}

// One English card item from its row, whose gloss repeats its claim.
export function englishItem(row: EnglishItemRow): Record<string, string> {
  const [kind, claim, turnId, quote] = row;
  return { kind, claim, lang: "en", gloss: claim, turn_id: turnId, quote };
}

// The fixture case data: names cases first, then card cases.
const ZERO = { cachedTokens: 0, reasoningTokens: 0 };
export const NAMES_FIXTURE_CASES: readonly NamesFixtureCase[] = [
  {
    name: "names-allowlist",
    displayName: "Tom",
    affiliations: ["Kopi Club"],
    turns: [
      "I asked Priya Nair to look over my plan before Friday, and she found two gaps.",
      "My manager Tom wants the report early, but I told him I need until Monday.",
      "Kopi Club is where I do my best thinking on Saturday mornings.",
    ],
    replies: [
      {
        names: [
          { text: "Priya Nair", role: "colleague" },
          { text: "Tom", role: "manager" },
        ],
      },
    ],
    usage: { promptTokens: 1200, completionTokens: 40, ...ZERO },
  },
  {
    name: "names-minor-and-placeholders",
    displayName: "Asha Rao",
    affiliations: [],
    turns: [
      "My daughter Meera starts school in June, so I leave work by four every day.",
      "Send the forms to [redacted:email:3f9a1c2e] before the deadline and call [redacted:phone:7b2d4e10] if anything is missing.",
      "We moved near [redacted:address:0c4e8a91] last spring and I love the walk to the park.",
    ],
    replies: [{ names: [{ text: "Meera", role: "child" }] }],
    usage: { promptTokens: 900, completionTokens: 20, ...ZERO },
  },
  {
    name: "names-none",
    displayName: "Lee Wong",
    affiliations: [],
    turns: [
      "I write my to-do list by hand because typing it makes me ignore it.",
      "Mornings are for deep work and afternoons are for meetings.",
      "I take a ten-minute walk after every long call.",
      "I keep one notebook per project and number every page.",
      "When I am stuck, I explain the problem out loud to an empty room.",
      "I leave my phone in another room when I write.",
      "Every Friday I tidy my desk and plan the first task for Monday.",
      "I would rather finish one thing than start three.",
    ],
    replies: [{ names: [] }],
    usage: { promptTokens: 700, completionTokens: 5, ...ZERO },
  },
  {
    name: "names-two-chunks",
    displayName: "Sam Price",
    affiliations: [],
    turns: [
      ...[0, 1, 2, 3, 4].map((index) => longText(`Note ${String(index)}:`, 19_000)),
      longText("Note 5: Dana from finance checks my numbers.", 19_000),
    ],
    replies: [{ names: [] }, { names: [{ text: "Dana", role: "colleague" }] }],
    usage: { promptTokens: 25000, completionTokens: 10, ...ZERO },
  },
];

// The source texts and reply rows of the card cases.
const SOURCE_A = [
  "I ask for written feedback because I forget half of what people say in meetings.",
  "I plan the whole week on Sunday night, otherwise Monday eats me alive.",
  "I do not answer work messages after nine at night, even when my team is in another time zone.",
  "I want to lead a small design team within the next two years.",
  "Honesty matters more to me than keeping a meeting comfortable.",
  "When two options look equally good, I pick the one I can undo later.",
  "I keep a notebook of every mistake I make at work so I do not repeat them.",
  "Can you help me write a polite email declining a project I do not have time for?",
];
const SOURCE_B = [
  "I would rather ship a small thing on Friday than a big thing next month.",
  "I block two hours every morning for work that needs deep focus.",
  "I never take calls during lunch because that hour is for walking.",
  "My goal this year is to publish one article about every project I finish.",
  "A team should argue in the room and agree once they leave it.",
  "I prefer short daily check-ins over one long weekly meeting.",
  "I learn a new tool by rebuilding an old project with it.",
];
const SOURCE_C = [
  "I tidy my desk before I leave so the next morning starts calm.",
  "I say no to meetings that have no agenda.",
  "I like to read the whole brief before I ask any question.",
  "I want to run my own studio one day.",
  "Being on time is a way of respecting people.",
];
const SOURCE_D = [
  "I write the agenda for every meeting I call, even the short ones.",
  "I want to mentor two junior designers next year.",
  "My doctor wants me to rest more, so I stopped working weekends.",
  "I would rather hear bad news early than good news late.",
  "I keep my phone in a drawer when I am writing.",
  "Credit belongs to the whole team, never to one person.",
  "I always test a new idea on a small group before I share it widely.",
];
const SOURCE_TAMIL = [
  "நான் காலையில் ஆறு மணிக்கு எழுந்து ஒரு மணி நேரம் படிக்கிறேன்.",
  "கூட்டங்களில் நான் கடைசியாகப் பேச விரும்புகிறேன்.",
  "வேலை நேரம் முடிந்த பிறகு நான் அலுவலக செய்திகளுக்கு பதில் அளிப்பதில்லை.",
  "அடுத்த இரண்டு ஆண்டுகளில் ஒரு சிறிய குழுவை வழிநடத்த வேண்டும் என்பது என் இலக்கு.",
  "தவறு செய்தால் உடனே ஒப்புக்கொள்வதுதான் சரி என்று நான் நம்புகிறேன்.",
  "எழுத்தில் வரும் கருத்துகளை நான் விரும்புகிறேன், ஏனென்றால் பின்னர் மீண்டும் படிக்க முடியும்.",
];
const SOURCE_E = [
  "I reply to every email within one working day.",
  "I prefer to work from the office on Tuesdays.",
  "I never skip the team retro, even when I am busy.",
  "I want to learn to give better talks this year.",
  "Kindness costs nothing and fixes a lot.",
  "I check my calendar every evening for the next day.",
];
const ITEMS_A = [
  englishItem([
    "preference",
    "Asks for written feedback so they can come back to it.",
    "0",
    "I ask for written feedback because I forget half",
  ]),
  englishItem([
    "habit",
    "Plans the whole week on Sunday night.",
    "1",
    "I plan the whole week on Sunday night",
  ]),
  englishItem([
    "boundary",
    "Does not answer work messages after nine at night.",
    "2",
    "I do not answer work messages after nine at night",
  ]),
  englishItem([
    "goal",
    "Wants to lead a small design team within two years.",
    "3",
    "I want to lead a small design team within the next two years",
  ]),
  englishItem([
    "value",
    "Puts honesty ahead of a comfortable meeting.",
    "4",
    "Honesty matters more to me than keeping a meeting comfortable",
  ]),
  englishItem([
    "preference",
    "Picks the option they can undo when two look equally good.",
    "5",
    "When two options look equally good, I pick the one I can undo later",
  ]),
  englishItem([
    "habit",
    "Keeps a notebook of their mistakes at work.",
    "6",
    "I keep a notebook of every mistake I make at work",
  ]),
];
const ITEMS_B = [
  englishItem([
    "preference",
    "Would rather ship something small soon than something big later.",
    "0",
    "I would rather ship a small thing on Friday than a big thing next month",
  ]),
  englishItem([
    "habit",
    "Blocks two hours every morning for focused work.",
    "1",
    "I block two hours every morning for work that needs deep focus",
  ]),
  englishItem([
    "boundary",
    "Does not take calls during lunch.",
    "2",
    "I never take calls during lunch",
  ]),
  englishItem([
    "goal",
    "Wants to publish one article about every finished project this year.",
    "3",
    "My goal this year is to publish one article about every project I finish",
  ]),
  englishItem([
    "value",
    "Believes a team should argue in the room and agree once it leaves.",
    "4",
    "A team should argue in the room and agree once they leave it",
  ]),
  englishItem([
    "preference",
    "Prefers short daily check-ins to one long weekly meeting.",
    "5",
    "I prefer short daily check-ins over one long weekly meeting",
  ]),
  englishItem([
    "habit",
    "Learns new tools by rebuilding old projects.",
    "6",
    "I learn new tools by rebuilding old projects",
  ]),
];
const ITEMS_C = [
  englishItem(["habit", "Tidies their desk before leaving.", "0", "I tidy my desk before I leave"]),
  englishItem([
    "boundary",
    "Declines meetings without an agenda.",
    "1",
    "I say no to meetings that have no agenda",
  ]),
  englishItem([
    "preference",
    "Reads the whole brief before asking questions.",
    "2",
    "I like to read the whole brief before I ask any question",
  ]),
  englishItem([
    "goal",
    "Wants to run their own studio one day.",
    "3",
    "I want to run my own studio one day",
  ]),
  englishItem([
    "value",
    "Sees punctuality as respect.",
    "4",
    "Being punctual is a way of respecting people",
  ]),
  englishItem([
    "boundary",
    "Declines meetings without an agenda.",
    "9",
    "I say no to meetings that have no agenda",
  ]),
];
const ITEMS_D = [
  englishItem([
    "habit",
    "Writes the agenda for every meeting they call.",
    "0",
    "I write the agenda for every meeting I call",
  ]),
  englishItem([
    "goal",
    "Wants to mentor two junior designers next year.",
    "1",
    "I want to mentor two junior designers next year",
  ]),
  englishItem([
    "preference",
    "Wants bad news early rather than good news late.",
    "3",
    "I would rather hear bad news early than good news late",
  ]),
  englishItem([
    "habit",
    "Keeps their phone in a drawer while writing.",
    "4",
    "I keep my phone in a drawer when I am writing",
  ]),
  englishItem([
    "value",
    "Gives credit to the whole team, never to one person.",
    "5",
    "Credit belongs to the whole team, never to one person",
  ]),
  englishItem([
    "habit",
    "Tests a new idea on a small group before sharing it.",
    "6",
    "I always test a new idea on a small group before I share it widely",
  ]),
];
const ITEMS_TAMIL = [
  {
    kind: "habit",
    claim: "காலையில் ஆறு மணிக்கு எழுந்து ஒரு மணி நேரம் படிக்கிறார்.",
    lang: "ta",
    gloss: "Wakes at six in the morning and reads for an hour.",
    turn_id: "0",
    quote: "நான் காலையில் ஆறு மணிக்கு எழுந்து ஒரு மணி நேரம் படிக்கிறேன்",
  },
  {
    kind: "preference",
    claim: "கூட்டங்களில் கடைசியாகப் பேச விரும்புகிறார்.",
    lang: "ta",
    gloss: "Likes to speak last in meetings.",
    turn_id: "1",
    quote: "கூட்டங்களில் நான் கடைசியாகப் பேச விரும்புகிறேன்",
  },
  {
    kind: "boundary",
    claim: "வேலை நேரம் முடிந்த பிறகு அலுவலக செய்திகளுக்கு பதில் அளிப்பதில்லை.",
    lang: "ta",
    gloss: "Does not answer office messages after work hours.",
    turn_id: "2",
    quote: "வேலை நேரம் முடிந்த பிறகு நான் அலுவலக செய்திகளுக்கு பதில் அளிப்பதில்லை",
  },
  {
    kind: "goal",
    claim: "ஒரு சிறிய குழுவை வழிநடத்த விரும்புகிறார்.",
    lang: "ta",
    gloss: "Wants to lead a small team.",
    turn_id: "3",
    quote: "ஒரு சிறிய குழுவை வழிநடத்த வேண்டும் என்பது என் இலக்கு",
  },
  {
    kind: "value",
    claim: "தவறை உடனே ஒப்புக்கொள்வது சரி என்று நம்புகிறார்.",
    lang: "ta",
    gloss: "Believes a mistake should be admitted at once.",
    turn_id: "4",
    quote: "தவறு செய்தால் உடனே ஒப்புக்கொள்வதுதான் சரி",
  },
  {
    kind: "preference",
    claim: "எழுத்தில் வரும் கருத்துகளை விரும்புகிறார்.",
    lang: "ta",
    gloss: "Prefers feedback in writing.",
    turn_id: "5",
    quote: "எழுத்தில் வரும் கருத்துகளை நான் விரும்புகிறேன்",
  },
];
export const CARD_FIXTURE_CASES: readonly CardFixtureCase[] = [
  {
    name: "card-ready",
    displayName: "Mina Park",
    turns: SOURCE_A,
    sensitive: {},
    optIn: [],
    firstReply: { items: ITEMS_A },
    regenerationReply: null,
    usage: { promptTokens: 2000, completionTokens: 900, ...ZERO },
    isReplyValid: true,
  },
  {
    name: "card-regenerate",
    displayName: "Omar Haddad",
    turns: SOURCE_B,
    sensitive: {},
    optIn: [],
    firstReply: { items: ITEMS_B },
    regenerationReply: { items: ITEMS_B },
    usage: { promptTokens: 1800, completionTokens: 800, ...ZERO },
    isReplyValid: true,
  },
  {
    name: "card-thin",
    displayName: "Ines Duarte",
    turns: SOURCE_C,
    sensitive: {},
    optIn: [],
    firstReply: { items: ITEMS_C },
    regenerationReply: { items: ITEMS_C },
    usage: { promptTokens: 1000, completionTokens: 500, ...ZERO },
    isReplyValid: true,
  },
  {
    name: "card-sensitive-excluded",
    displayName: "Kai Moreno",
    turns: SOURCE_D,
    sensitive: { 2: ["health"] },
    optIn: [],
    firstReply: { items: ITEMS_D },
    regenerationReply: null,
    usage: { promptTokens: 1500, completionTokens: 600, ...ZERO },
    isReplyValid: true,
  },
  {
    name: "card-sensitive-opted-in",
    displayName: "Lena Brandt",
    turns: SOURCE_D,
    sensitive: { 2: ["health"] },
    optIn: ["health"],
    firstReply: {
      items: [
        ...ITEMS_D,
        englishItem(["boundary", "Does not work weekends.", "2", "so I stopped working weekends"]),
      ],
    },
    regenerationReply: null,
    usage: { promptTokens: 1600, completionTokens: 650, ...ZERO },
    isReplyValid: true,
  },
  {
    name: "card-tamil",
    displayName: "Priya Raman",
    turns: SOURCE_TAMIL,
    sensitive: {},
    optIn: [],
    firstReply: { items: ITEMS_TAMIL },
    regenerationReply: null,
    usage: { promptTokens: 900, completionTokens: 700, ...ZERO },
    isReplyValid: true,
  },
  {
    name: "card-output-invalid",
    displayName: "Sam Okafor",
    turns: SOURCE_E,
    sensitive: {},
    optIn: [],
    firstReply: {
      items: [
        englishItem([
          "habit",
          "Replies to every email within one working day.",
          "0",
          "I reply to every email within one working day",
        ]),
        englishItem([
          "preference",
          "Prefers working from the office on Tuesdays.",
          "1",
          "I prefer to work from the office on Tuesdays",
        ]),
        englishItem([
          "boundary",
          "Never skips the team retro.",
          "2",
          "I never skip the team retro",
        ]),
      ],
    },
    regenerationReply: null,
    usage: { promptTokens: 1100, completionTokens: 200, ...ZERO },
    isReplyValid: false,
  },
];
