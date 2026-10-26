import { z } from "zod";
import { Side, Uuid } from "../primitives.js";

// One claim a persona made in a turn, with the quote it rests on (R6.4 and R6.5).
export const Claim = z.object({
  id: Uuid,
  side: Side,
  position: z.number().int().min(1),
  text: z.string(),
  quote: z.string(),
  gloss: z.string().optional(),
  lang: z.string(),
  turnId: Uuid,
  verified: z.boolean(),
  flagged: z.boolean(),
  evidenceValid: z.boolean(),
});
// The type of Claim, read from the schema above.
export type Claim = z.infer<typeof Claim>;
// What the receipts model returns for one turn: its claims with their quotes and turn labels (meeting-receipts prompt).
export const ReceiptsOutput = z.object({
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
    .max(8),
});
// The type of ReceiptsOutput, read from the schema above.
export type ReceiptsOutput = z.infer<typeof ReceiptsOutput>;
// Most claims one turn may carry. This bounds the receipts output and is picked here [confirm].
export const CLAIMS_PER_TURN_MAX = 8;
