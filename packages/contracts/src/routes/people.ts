import { z } from "zod";
import { HomeView, MyPhoto, NameUpdate, NameUpdated, PersonCreate, PersonCreateResponse, Recover, RecoverResponse, TransferClaim, TransferClaimResponse, TransferResponse } from "../people/index.js";
import { DeletionResponse, Health } from "../operations/index.js";

// Routes for people and sessions. Paths come from IMPLEMENTATION.md 2.2; no app retypes them.
// The routes this feature serves, keyed by name.
export const peopleRoutes = {
  createPerson: { method: "POST", path: "/api/people", request: PersonCreate, response: PersonCreateResponse, public: true },
  recover: { method: "POST", path: "/api/sessions/recover", request: Recover, response: RecoverResponse, public: true },
  transfer: { method: "POST", path: "/api/sessions/transfer", request: z.undefined(), response: TransferResponse },
  claim: { method: "POST", path: "/api/sessions/claim", request: TransferClaim, response: TransferClaimResponse, public: true },
  deleteMe: { method: "DELETE", path: "/api/people/me", request: z.undefined(), response: DeletionResponse },
  readHome: { method: "GET", path: "/api/home", request: z.undefined(), response: HomeView },
  // Instagram's Edit profile (3 Nov 2026): a new display name, and a profile photo sent as the JPEG bytes themselves (image/jpeg), which
  // GET /api/photos/:id sends back as image/jpeg to anyone signed in who was shown its id.
  updateName: { method: "PUT", path: "/api/people/me/name", request: NameUpdate, response: NameUpdated },
  uploadPhoto: { method: "PUT", path: "/api/people/me/photo", request: z.undefined(), response: MyPhoto },
  removePhoto: { method: "DELETE", path: "/api/people/me/photo", request: z.undefined(), response: MyPhoto },
  readPhoto: { method: "GET", path: "/api/photos/:id", request: z.undefined(), response: z.undefined() },
  health: { method: "GET", path: "/api/health", request: z.undefined(), response: Health, public: true },
} as const;
