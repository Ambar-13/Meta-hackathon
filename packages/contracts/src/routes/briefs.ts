import { z } from "zod";
import { Brief, ComicRequest, ComicRequestResponse, ComicView, ConsentResponse, ConsentWithdrawResponse, ShareSnapshot } from "../briefs/index.js";

// Routes for briefs, comics, consent and the share page. Paths come from IMPLEMENTATION.md 2.2.
// The panel image is a binary webp, so it has no JSON response schema.
export const briefsRoutes = {
  readBrief: { method: "GET", path: "/api/meetings/:id/brief", request: z.undefined(), response: Brief },
  requestComic: { method: "POST", path: "/api/meetings/:id/comic", request: ComicRequest, response: ComicRequestResponse },
  readComic: { method: "GET", path: "/api/meetings/:id/comic", request: z.undefined(), response: ComicView },
  panelImage: { method: "GET", path: "/api/comics/:id/panels/:position", request: z.undefined(), response: z.undefined() },
  consent: { method: "POST", path: "/api/meetings/:id/consent", request: z.undefined(), response: ConsentResponse },
  withdrawConsent: { method: "DELETE", path: "/api/meetings/:id/consent", request: z.undefined(), response: ConsentWithdrawResponse },
  readShare: { method: "GET", path: "/api/share/:slug", request: z.undefined(), response: ShareSnapshot, public: true },
} as const;
