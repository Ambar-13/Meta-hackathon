// Turns a briefs row into the Brief the browser renders. The three jsonb columns are parsed with BriefPoint, so a broken row fails here and not on a phone.
import { Brief, BriefPoint } from "@meet-first/contracts";
import { z } from "zod";

// The columns of one briefs row the view reads; the numeric column comes back from Postgres as text.
export type BriefRow = { agree: unknown; clash: unknown; decide_first: unknown; support_rate: string | number | null; support_reliable: boolean | null };

// The three sections of a brief: exactly three lines each, every one a parsed BriefPoint.
const Section = z.array(BriefPoint).length(3);

// Turns a briefs row into the Brief contract (R6.5, A1, invariant 19). A stored null support flag stays null.
export function toBriefView(row: BriefRow): Brief {
  return Brief.parse({
    agree: Section.parse(row.agree),
    clash: Section.parse(row.clash),
    decideFirst: Section.parse(row.decide_first),
    supportRate: row.support_rate === null ? null : Number(row.support_rate),
    supportReliable: row.support_reliable,
  });
}
