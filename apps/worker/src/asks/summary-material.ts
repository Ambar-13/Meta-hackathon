// A subject's checked summary as a persona request uses it: the points found in the subject's own messages, quotable with their turns,
// and the points not found, which the persona says as "likely". Read in the subject's own context; a help ask never reads it.
import { SummaryPointView, type AskMode } from "@meet-first/contracts";
import type { DatabaseTransaction } from "@meet-first/db";
import type { CitableTurn } from "../meetings/receipts.js";
import type { PersonaItem } from "./ask-requests.js";

// One found point, shown like a card item, with the whole turn its quote comes from.
export type FoundPoint = { item: PersonaItem; turn: CitableTurn };
// What a request takes from the summary: the found points, and the text of every other point.
export type SummaryMaterial = { found: FoundPoint[]; only: string[] };

// The subject's checked points when this ask may use them: a react ask only when the summary's friends switch is on, a help ask never,
// any other ask (the subject's own) always. Empty when there is no ready summary or its points do not read.
export async function readUsablePoints(trx: DatabaseTransaction, personId: string, mode: AskMode): Promise<SummaryPointView[]> {
  const needsSwitch = mode === "react";
  if (mode === "help") return [];
  const row = await trx.selectFrom("person_summaries").select(["points", "friends_can_ask"]).where("person_id", "=", personId).where("state", "=", "ready").executeTakeFirst();
  if (row === undefined || (needsSwitch && !row.friends_can_ask)) return [];
  const parsed = SummaryPointView.array().safeParse(row.points);
  return parsed.success ? parsed.data : [];
}

// The found points with their turns, and the rest as their text; a found point whose turn is gone, with its upload, joins the rest.
export async function readSummaryMaterial(trx: DatabaseTransaction, points: readonly SummaryPointView[]): Promise<SummaryMaterial> {
  const ids = points.flatMap((point) => (point.found === null ? [] : [point.found.turnId]));
  const turns = ids.length === 0 ? [] : await trx.selectFrom("turns").select(["id", "turn_index", "text", "norm_text"]).where("id", "in", ids).execute();
  const material: SummaryMaterial = { found: [], only: [] };
  for (const point of points) {
    const found = point.found;
    const turn = found === null ? undefined : turns.find((row) => row.id === found.turnId);
    if (found === null || turn === undefined) {
      material.only.push(point.point);
      continue;
    }
    const item = { turnIndex: turn.turn_index, kind: point.kind, claim: point.point, quote: found.quote };
    material.found.push({ item, turn: { turnId: turn.id, turnIndex: turn.turn_index, text: turn.text, normText: turn.norm_text } });
  }
  return material;
}
