import { z } from "zod";
import { IsoTime, Uuid } from "../primitives.js";

// What an ask is: help sends one stuck problem to many listed personas; react asks one friend's persona how they would probably react.
export const AskMode = z.enum(["help", "react"]);
// The type of AskMode, read from the schema above.
export type AskMode = z.infer<typeof AskMode>;
// Most help searches one person may start per UTC day.
export const HELP_SEARCHES_PER_PERSON_PER_DAY = 5;
// Most react asks one person may send per UTC day.
export const REACT_ASKS_PER_PERSON_PER_DAY = 20;
// Most listed personas one help search asks: the shortlist of stage 1.
export const HELP_SHORTLIST_MAX = 20;
// Most claims one persona answer may carry.
export const ANSWER_CLAIMS_MAX = 3;
// Most claims one support-check call judges; a help search makes at most two such calls.
export const ASK_JUDGE_ITEMS_MAX = 30;
// How many of the best-placed help answers can be met in a full meeting.
export const HELP_MEETABLE_TOP = 3;
// Milliseconds between two reads of an ask while it runs.
export const ASK_POLL_MS = 3_000;
// The heading over the help results; the list is never a score of a person.
export const HELP_RESULTS_HEADING = "Who could probably help, and why";
// The words under the help box, shown before the search is sent.
export const HELP_SEND_COPY = "Your problem goes to the Meetys of up to 20 people in Explore. Each answers from the items its person marked public, and each of those people gets a copy of the answer with your display name.";

// The body of POST /api/asks. A route schema, not a model output, so the union is allowed here.
export const AskCreate = z.union([
  z.object({ mode: z.literal("help"), text: z.string().trim().min(5).max(300) }),
  z.object({ mode: z.literal("react"), pairId: Uuid, text: z.string().trim().min(5).max(300) }),
]);
// The type of AskCreate, read from the schema above.
export type AskCreate = z.infer<typeof AskCreate>;
// What POST /api/asks returns.
export const AskCreateResponse = z.object({ askId: Uuid });
// The type of AskCreateResponse, read from the schema above.
export type AskCreateResponse = z.infer<typeof AskCreateResponse>;
// Where an ask is: the question check, the persona calls, the support check, then done; or refused by the check, or failed.
export const AskState = z.enum(["checking", "asking", "ranking", "done", "refused", "failed"]);
// The type of AskState, read from the schema above.
export type AskState = z.infer<typeof AskState>;
// One claim of an answer with its quote: verified when the quote was found in the named turn, supported when the support check backed it.
export const AnswerClaim = z.object({ text: z.string(), quote: z.string(), verified: z.boolean(), supported: z.boolean().nullable() });
// The type of AnswerClaim, read from the schema above.
export type AnswerClaim = z.infer<typeof AnswerClaim>;
// One persona's answer as the asker sees it. position is its place in the help results, null when it showed no sign; canMeet is true for the
// first HELP_MEETABLE_TOP placed answers whose listing still exists.
export const AskAnswer = z.object({
  answerId: Uuid,
  displayName: z.string(),
  line: z.string().nullable(),
  answer: z.string(),
  claims: z.array(AnswerClaim),
  hasSign: z.boolean(),
  position: z.number().int().min(1).nullable(),
  canMeet: z.boolean(),
});
// The type of AskAnswer, read from the schema above.
export type AskAnswer = z.infer<typeof AskAnswer>;
// What GET /api/asks/:id returns to the asker. aboutName is the friend's display name for a react ask.
export const AskView = z.object({
  askId: Uuid,
  mode: AskMode,
  text: z.string(),
  state: AskState,
  refusedReason: z.string().nullable(),
  aboutName: z.string().nullable(),
  answers: z.array(AskAnswer),
  createdAt: IsoTime,
});
// The type of AskView, read from the schema above.
export type AskView = z.infer<typeof AskView>;
// One ask in the asker's list.
export const AskSummary = z.object({ askId: Uuid, mode: AskMode, text: z.string(), state: AskState, createdAt: IsoTime });
// The type of AskSummary, read from the schema above.
export type AskSummary = z.infer<typeof AskSummary>;
// One answer the caller's persona gave, as the caller's copy: what was asked, who asked, and the answer with its quotes.
export const AboutMeAnswer = z.object({ answerId: Uuid, mode: AskMode, text: z.string(), askerName: z.string(), answer: z.string(), claims: z.array(AnswerClaim), createdAt: IsoTime });
// The type of AboutMeAnswer, read from the schema above.
export type AboutMeAnswer = z.infer<typeof AboutMeAnswer>;
// What GET /api/asks returns: the caller's own asks, newest first, and every answer their persona gave, newest first.
export const AsksView = z.object({ asked: z.array(AskSummary), aboutMe: z.array(AboutMeAnswer) });
// The type of AsksView, read from the schema above.
export type AsksView = z.infer<typeof AsksView>;
// The body of POST /api/asks/:id/answers/:answerId/meeting: the card to speak from in a full meeting with that helper.
export const AnswerMeetingCreate = z.object({ cardId: Uuid });
// The type of AnswerMeetingCreate, read from the schema above.
export type AnswerMeetingCreate = z.infer<typeof AnswerMeetingCreate>;
// What the persona-answer model returns: a hedged answer of at most 120 words, whether the person's material shows anything on the
// question, and up to ANSWER_CLAIMS_MAX claims, each with an exact quote and its turn label (persona-answer prompt).
export const PersonaAnswerOutput = z.object({
  answer: z.string().max(900),
  has_sign: z.boolean(),
  claims: z
    .array(
      z.object({
        text: z.string().min(1).max(300),
        quote: z.string().min(1).max(600),
        turn_id: z.string().min(1),
        lang: z.string().min(2).max(35),
        gloss: z.string().min(1).max(300),
      }),
    )
    .max(ANSWER_CLAIMS_MAX),
});
// The type of PersonaAnswerOutput, read from the schema above.
export type PersonaAnswerOutput = z.infer<typeof PersonaAnswerOutput>;
// What the search-words model returns: 1 to 8 words or short phrases, each 1 to 40 characters, that the person would likely have used
// in their own messages about what an ask is about (search-words prompt).
export const SearchWordsOutput = z.object({ words: z.array(z.string().min(1).max(40)).min(1).max(8) });
// The type of SearchWordsOutput, read from the schema above.
export type SearchWordsOutput = z.infer<typeof SearchWordsOutput>;
