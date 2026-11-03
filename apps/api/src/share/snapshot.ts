import { randomBytes } from "node:crypto";
import { type QuestionKind, BriefPoint, ContractError, FORBIDDEN_SHARE_KEYS, HTTP, rowToEvent, SHARE_SLUG_BYTES, ShareSnapshot } from "@meet-first/contracts";
import type { DatabaseTransaction } from "@meet-first/db";

// Random bytes in a share slug, from the contracts: 16 bytes, which is 22 URL-safe base64 characters.
export const SLUG_BYTES = SHARE_SLUG_BYTES;

// The side letter of a member, as ShareSnapshot spells it.
type Side = ShareSnapshot["people"][number]["side"];
// The shared-line shape of one brief point, as ShareSnapshot holds it.
type SharedLine = ShareSnapshot["brief"]["agree"][number];
// One comic panel as the snapshot holds it.
type ComicLine = { caption: string; imageUrl: string };
// One member of the meeting: the side, the person row id (never sent out), and the display name.
type Member = { side: Side; personId: string; displayName: string };
// One stored brief row as the snapshot reads it, with the person it belongs to.
type BriefRow = { person_id: string; agree: unknown; clash: unknown; decide_first: unknown };
// The three sections of a brief, by their column names.
type Section = "agree" | "clash" | "decide_first";

// The sentence for a snapshot that failed its own check; nothing is stored when it is raised (share_snapshot_invalid).
function snapshotInvalid(): ContractError {
  return new ContractError("share_snapshot_invalid", "The share snapshot failed its own check and was not stored. Nothing is public. Report this with the meeting id.", HTTP.internal);
}

// Returns a new random slug of 22 characters, unrelated to any id.
export function makeSlug(): string {
  return randomBytes(SLUG_BYTES).toString("base64url");
}

// Walks every key of a value and throws share_snapshot_forbidden_key when one of FORBIDDEN_SHARE_KEYS appears at any depth.
// Values may contain those words; only keys are checked.
export function assertNoForbiddenKeys(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach((item: unknown) => {
      assertNoForbiddenKeys(item);
    });
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, child] of Object.entries(value)) {
    if ((FORBIDDEN_SHARE_KEYS as readonly string[]).includes(key)) {
      throw new ContractError("share_snapshot_forbidden_key", "The share snapshot holds a key that must never be public. Nothing was stored. Report this with the meeting id.", HTTP.internal);
    }
    assertNoForbiddenKeys(child);
  }
}

// Returns true when a brief line may be shared: the support judge said yes and every quote was found in its turn.
export function isShareableLine(point: BriefPoint): boolean {
  return point.supported === true && point.quotes.length > 0 && point.quotes.every((quote) => quote.verified);
}

// Reads the question the meeting was asked and its kind, which picks the public page's section labels.
async function readQuestion(trx: DatabaseTransaction, meetingId: string): Promise<{ text: string; kind: QuestionKind }> {
  const meeting = await trx.selectFrom("meetings").select(["question_text", "question_kind"]).where("id", "=", meetingId).executeTakeFirstOrThrow();
  return { text: meeting.question_text, kind: meeting.question_kind };
}

// Reads both members with their sides and display names; the names come from people, which the meeting context may read.
async function readMembers(trx: DatabaseTransaction, meetingId: string): Promise<Member[]> {
  const rows = await trx
    .selectFrom("meeting_members as mm")
    .innerJoin("people as p", "p.id", "mm.person_id")
    .select(["mm.side", "mm.person_id", "p.display_name"])
    .where("mm.meeting_id", "=", meetingId)
    .orderBy("mm.side")
    .execute();
  return rows.map((row) => ({ side: row.side, personId: row.person_id, displayName: row.display_name }));
}

// Reads the approved, verified card items of both sides, in side order and then in card position order; a listed persona met through the
// directory shows only its public items.
async function readItems(trx: DatabaseTransaction, meetingId: string): Promise<Array<{ side: Side; kind: "value" | "preference" | "habit" | "boundary" | "goal"; claim: string; quote: string }>> {
  const rows = await trx
    .selectFrom("card_items as ci")
    .innerJoin("meeting_members as mm", "mm.card_id", "ci.card_id")
    .select(["mm.side", "ci.kind", "ci.claim", "ci.quote"])
    .where("mm.meeting_id", "=", meetingId)
    .where("ci.approved", "=", true)
    .where("ci.verified", "=", true)
    .where((eb) => eb.or([eb("mm.public_only", "=", false), eb("ci.is_public", "=", true)]))
    .orderBy("mm.side")
    .orderBy("ci.position")
    .execute();
  return rows.map((row) => ({ side: row.side, kind: row.kind, claim: row.claim, quote: row.quote }));
}

// Reads each committed turn in order, keeping only the claims that were verified.
async function readTurns(trx: DatabaseTransaction, meetingId: string): Promise<Array<{ side: Side; text: string; claims: Array<{ text: string; quote: string }> }>> {
  const rows = await trx
    .selectFrom("meeting_events")
    .select(["meeting_id", "seq", "type", "v", "payload", "created_at"])
    .where("meeting_id", "=", meetingId)
    .where("type", "=", "turn.committed")
    .orderBy("seq")
    .execute();
  return rows.flatMap((row) => {
    const event = rowToEvent(row);
    if (event.type !== "turn.committed") return [];
    const claims = event.claims.filter((claim) => claim.verified).map((claim) => ({ text: claim.text, quote: claim.quote }));
    return [{ side: event.side, text: event.text, claims }];
  });
}

// Reads both brief rows, side a's first, so a line that both briefs hold keeps side a's place.
async function readBriefs(trx: DatabaseTransaction, meetingId: string, sideOf: ReadonlyMap<string, Side>): Promise<BriefRow[]> {
  const rows = await trx.selectFrom("briefs").select(["person_id", "agree", "clash", "decide_first"]).where("meeting_id", "=", meetingId).execute();
  return rows.sort((left, right) => (sideOf.get(left.person_id) ?? "b").localeCompare(sideOf.get(right.person_id) ?? "b"));
}

// Reads the comic panels when the comic is ready; null when it is not, so the snapshot has no comic field.
async function readComic(trx: DatabaseTransaction, meetingId: string): Promise<ComicLine[] | null> {
  const comic = await trx.selectFrom("comics").select(["id", "state"]).where("meeting_id", "=", meetingId).executeTakeFirst();
  if (comic === undefined || comic.state !== "ready") return null;
  const panels = await trx.selectFrom("comic_panels").select(["caption", "image"]).where("comic_id", "=", comic.id).orderBy("position").execute();
  return panels.map((panel) => ({ caption: panel.caption, imageUrl: `data:image/webp;base64,${panel.image.toString("base64")}` }));
}

// Reads the stored lines of one brief section; a line that does not parse as a BriefPoint is left out.
function parsedPoints(stored: unknown): BriefPoint[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((line: unknown) => {
    const parsed = BriefPoint.safeParse(line);
    return parsed.success ? [parsed.data] : [];
  });
}

// Turns a brief point into the shape the public page shows: its text and quotes, with no turn ids.
function toSharedLine(point: BriefPoint): SharedLine {
  return { text: point.text, quotes: point.quotes.map((quote) => ({ text: quote.text, side: quote.side })) };
}

// The shareable lines of one section across both briefs, deduplicated by exact text, side a's brief first.
function sharedSection(briefs: readonly BriefRow[], section: Section): SharedLine[] {
  const seen = new Set<string>();
  const lines: SharedLine[] = [];
  for (const brief of briefs) {
    for (const point of parsedPoints(brief[section])) {
      if (!isShareableLine(point) || seen.has(point.text)) continue;
      seen.add(point.text);
      lines.push(toSharedLine(point));
    }
  }
  return lines;
}

// Parses the candidate as ShareSnapshot and checks its keys; any failure is share_snapshot_invalid, so nothing is stored.
function checkedSnapshot(candidate: unknown): ShareSnapshot {
  const parsed = ShareSnapshot.safeParse(candidate);
  if (!parsed.success) throw snapshotInvalid();
  try {
    assertNoForbiddenKeys(parsed.data);
  } catch (error: unknown) {
    if (error instanceof ContractError) throw snapshotInvalid();
    throw error;
  }
  return parsed.data;
}

// Builds the public snapshot inside the meeting context, so both members' rows and briefs are visible; the caller has
// already proved membership in withPerson. Every field of the public page is read here and nowhere else.
export async function buildShareSnapshot(trx: DatabaseTransaction, meetingId: string): Promise<ShareSnapshot> {
  const question = await readQuestion(trx, meetingId);
  const members = await readMembers(trx, meetingId);
  const sideOf = new Map(members.map((member) => [member.personId, member.side] as const));
  const briefs = await readBriefs(trx, meetingId, sideOf);
  const items = await readItems(trx, meetingId);
  const turns = await readTurns(trx, meetingId);
  const comic = await readComic(trx, meetingId);
  const candidate = {
    question: question.text,
    questionKind: question.kind,
    people: members.map((member) => ({ side: member.side, displayName: member.displayName })),
    items,
    turns,
    brief: { agree: sharedSection(briefs, "agree"), clash: sharedSection(briefs, "clash"), decideFirst: sharedSection(briefs, "decide_first") },
    ...(comic === null ? {} : { comic }),
  };
  return checkedSnapshot(candidate);
}
