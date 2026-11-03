// Reads the plain rows the seven metrics need for the driven pairs: meeting rows under withMeeting, card ledger rows under withPerson.
import type { Kysely } from "kysely";
import { BriefPoint, type Quote } from "@meet-first/contracts";
import { numberFromPostgres, withMeeting, withPerson, type Database, type DatabaseTransaction } from "@meet-first/db";
import type { DrivenPair } from "./drive-pair.js";

// One committed claim of a meeting, with the flags the metrics read.
export type ClaimRow = { meetingId: string; side: "a" | "b"; verified: boolean; flagged: boolean; evidenceValid: boolean; text: string };
// One brief line, with the section it sits in and the point itself.
export type BriefLineRow = { meetingId: string; personId: string; section: "agree" | "clash" | "decideFirst"; point: BriefPoint };
// One turn a brief quote points at, with its stored normal text for the quote check.
export type TurnTextRow = { turnId: string; personId: string; text: string; normText: string };
// One brief's support judgement.
export type BriefMetaRow = { meetingId: string; personId: string; supportRate: number | null; supportReliable: boolean | null };
// One meeting event the metrics read: its sequence number, its type and its stored payload.
export type EventRow = { meetingId: string; seq: number; type: string; payload: unknown };
// One meeting's state, times and brief count.
export type MeetingRow = { meetingId: string; state: string; endReason: string | null; startedAt: Date | null; firstTokenAt: Date | null; briefCount: number };
// One ledger row: a meeting call or a person's card build, with its dollars when the row has them.
export type LedgerRow = { meetingId: string | null; personId: string | null; callSite: string; usd: number | null; model: string };
// The markers planted in one meeting, and the side whose notes carried them.
export type PlantedMarkerRow = { meetingId: string; side: "a" | "b"; markers: string[] };
// Every row the metrics read, across the driven pairs.
export type EvalRows = {
  claims: ClaimRow[];
  briefLines: BriefLineRow[];
  turns: Map<string, TurnTextRow>;
  briefMeta: BriefMetaRow[];
  events: EventRow[];
  meetings: MeetingRow[];
  ledger: LedgerRow[];
  questionByMeeting: Map<string, string>;
  personBySide: Map<string, Record<"a" | "b", string>>;
  plantedMarkers: PlantedMarkerRow[];
};

// The event types the metrics read from a meeting's stream.
const READ_EVENT_TYPES = ["turn.committed", "tool.called", "brief.ready", "meeting.ended"];
// The brief sections in the database, with the name the metrics use.
const SECTIONS: ReadonlyArray<["agree" | "clash" | "decide_first", "agree" | "clash" | "decideFirst"]> = [
  ["agree", "agree"],
  ["clash", "clash"],
  ["decide_first", "decideFirst"],
];

// Postgres returns numeric columns as text; a null stays null.
function numberOf(value: string | null): number | null {
  return value === null ? null : numberFromPostgres(value);
}

// Reads the claims of one meeting.
async function readClaims(trx: DatabaseTransaction, meetingId: string): Promise<ClaimRow[]> {
  const rows = await trx.selectFrom("claims").select(["side", "verified", "flagged", "evidence_valid", "text"]).where("meeting_id", "=", meetingId).execute();
  return rows.map((row) => ({ meetingId, side: row.side, verified: row.verified, flagged: row.flagged, evidenceValid: row.evidence_valid, text: row.text }));
}

// Reads the brief rows of one meeting: the lines of each section, parsed with BriefPoint, and each brief's support judgement.
async function readBriefs(trx: DatabaseTransaction, meetingId: string): Promise<{ lines: BriefLineRow[]; meta: BriefMetaRow[] }> {
  const rows = await trx.selectFrom("briefs").select(["person_id", "agree", "clash", "decide_first", "support_rate", "support_reliable"]).where("meeting_id", "=", meetingId).execute();
  const lines = rows.flatMap((row) =>
    SECTIONS.flatMap(([column, section]) => row[column].map((point) => ({ meetingId, personId: row.person_id, section, point: BriefPoint.parse(point) }))),
  );
  const meta = rows.map((row) => ({
    meetingId,
    personId: row.person_id,
    supportRate: numberOf(row.support_rate),
    supportReliable: row.support_reliable,
  }));
  return { lines, meta };
}

// Reads the turns that the brief quotes point at, from both members (the meeting context sees both).
async function readCitedTurns(trx: DatabaseTransaction, lines: BriefLineRow[]): Promise<TurnTextRow[]> {
  const citedIds = [...new Set(lines.flatMap((line) => line.point.quotes.map((quote: Quote) => quote.turnId)))];
  if (citedIds.length === 0) return [];
  const rows = await trx.selectFrom("turns").select(["id", "person_id", "text", "norm_text"]).where("id", "in", citedIds).execute();
  return rows.map((row) => ({ turnId: row.id, personId: row.person_id, text: row.text, normText: row.norm_text }));
}

// Reads the events of one meeting that the metrics read, in sequence order.
async function readEvents(trx: DatabaseTransaction, meetingId: string): Promise<EventRow[]> {
  const rows = await trx.selectFrom("meeting_events").select(["seq", "type", "payload"]).where("meeting_id", "=", meetingId).where("type", "in", READ_EVENT_TYPES).orderBy("seq").execute();
  return rows.map((row) => ({ meetingId, seq: row.seq, type: row.type, payload: row.payload }));
}

// Reads the meeting's ledger rows: the calls the meeting made.
async function readMeetingLedger(trx: DatabaseTransaction, meetingId: string): Promise<LedgerRow[]> {
  const rows = await trx.selectFrom("ledger").select(["meeting_id", "person_id", "call_site", "usd", "model"]).where("meeting_id", "=", meetingId).execute();
  return rows.map(toLedgerRow);
}

// Turns one ledger database row into the row the metrics read.
function toLedgerRow(row: { meeting_id: string | null; person_id: string | null; call_site: string; usd: string | null; model: string }): LedgerRow {
  return { meetingId: row.meeting_id, personId: row.person_id, callSite: row.call_site, usd: numberOf(row.usd), model: row.model };
}

// Adds one driven pair's meeting rows to the collection: its claims, briefs, turns, events, meeting row and ledger rows.
async function addMeetingRows(db: Kysely<Database>, pair: DrivenPair, rows: EvalRows): Promise<void> {
  await withMeeting(db, pair.meetingId, async (trx) => {
    const meeting = await trx.selectFrom("meetings").select(["state", "end_reason", "started_at", "question_text"]).where("id", "=", pair.meetingId).executeTakeFirstOrThrow();
    const first = await trx.selectFrom("meeting_steps").select("first_token_at").where("meeting_id", "=", pair.meetingId).where("step_seq", "=", 1).executeTakeFirst();
    const briefs = await readBriefs(trx, pair.meetingId);
    const turns = await readCitedTurns(trx, briefs.lines);
    rows.claims.push(...(await readClaims(trx, pair.meetingId)));
    rows.briefLines.push(...briefs.lines);
    rows.briefMeta.push(...briefs.meta);
    for (const turn of turns) rows.turns.set(turn.turnId, turn);
    rows.events.push(...(await readEvents(trx, pair.meetingId)));
    rows.ledger.push(...(await readMeetingLedger(trx, pair.meetingId)));
    rows.questionByMeeting.set(pair.meetingId, meeting.question_text);
    rows.meetings.push({
      meetingId: pair.meetingId,
      state: meeting.state,
      endReason: meeting.end_reason,
      startedAt: meeting.started_at,
      firstTokenAt: first?.first_token_at ?? null,
      briefCount: briefs.meta.length,
    });
  });
}

// Reads one person's card build rows: the ledger rows of their card calls, under their own person context.
async function addCardRows(db: Kysely<Database>, personId: string, rows: EvalRows): Promise<void> {
  const cards = await withPerson(db, personId, (trx) =>
    trx.selectFrom("ledger").select(["meeting_id", "person_id", "call_site", "usd", "model"]).where("person_id", "=", personId).where("call_site", "=", "card").execute(),
  );
  rows.ledger.push(...cards.map(toLedgerRow));
}

// Reads every row the metrics need for the driven pairs. Nothing is read outside withMeeting or withPerson.
export async function collectRows(db: Kysely<Database>, pairs: readonly DrivenPair[]): Promise<EvalRows> {
  const rows: EvalRows = {
    claims: [], briefLines: [], turns: new Map(), briefMeta: [], events: [], meetings: [], ledger: [],
    questionByMeeting: new Map(), personBySide: new Map(), plantedMarkers: [],
  };
  for (const pair of pairs) {
    rows.personBySide.set(pair.meetingId, { a: pair.persons.a.personId, b: pair.persons.b.personId });
    for (const side of ["a", "b"] as const) {
      const markers = pair.markers[side];
      if (markers.length > 0) rows.plantedMarkers.push({ meetingId: pair.meetingId, side, markers });
    }
    await addMeetingRows(db, pair, rows);
    await addCardRows(db, pair.persons.a.personId, rows);
    await addCardRows(db, pair.persons.b.personId, rows);
  }
  return rows;
}
