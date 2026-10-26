import { z } from "zod";
import { PersonCreate, PersonCreateResponse, Recover, RecoverResponse, TransferClaim, TransferClaimResponse, TransferResponse } from "../people/index.js";
import { DeletionResponse, Health } from "../operations/index.js";

// Routes for people and sessions. Paths come from IMPLEMENTATION.md 2.2; no app retypes them.
// The routes this feature serves, keyed by name.
export const peopleRoutes = {
  createPerson: { method: "POST", path: "/api/people", request: PersonCreate, response: PersonCreateResponse, public: true },
  recover: { method: "POST", path: "/api/sessions/recover", request: Recover, response: RecoverResponse, public: true },
  transfer: { method: "POST", path: "/api/sessions/transfer", request: z.undefined(), response: TransferResponse },
  claim: { method: "POST", path: "/api/sessions/claim", request: TransferClaim, response: TransferClaimResponse, public: true },
  deleteMe: { method: "DELETE", path: "/api/people/me", request: z.undefined(), response: DeletionResponse },
  health: { method: "GET", path: "/api/health", request: z.undefined(), response: Health, public: true },
} as const;
