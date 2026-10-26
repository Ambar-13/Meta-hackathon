import type { Transaction } from "kysely";
import type { Database } from "@meet-first/db";

// Whether the member speaking with this card in this meeting is a listed persona met through the directory, whose prompt, receipts
// and brief may use only the items its owner marked public (as-built item 49).
export async function isPublicOnlyCard(trx: Transaction<Database>, meetingId: string, cardId: string): Promise<boolean> {
  const row = await trx.selectFrom("meeting_members").select("public_only").where("meeting_id", "=", meetingId).where("card_id", "=", cardId).executeTakeFirst();
  return row?.public_only === true;
}
