import { z } from "zod";
import { CardRequestResponse } from "../cards/index.js";
import { NamesReview, NamesReviewResponse, SourceCreateResponse, SourceView } from "../sources/index.js";

// Routes for uploads, the names review and card requests. Paths come from IMPLEMENTATION.md 2.2.
// The body of POST /api/sources is NDJSON, so the zod request is undefined.
export const sourcesRoutes = {
  createSource: { method: "POST", path: "/api/sources", request: z.undefined(), response: SourceCreateResponse },
  readSource: { method: "GET", path: "/api/sources/:id", request: z.undefined(), response: SourceView },
  namesReview: { method: "POST", path: "/api/sources/:id/names-review", request: NamesReview, response: NamesReviewResponse },
  requestCard: { method: "POST", path: "/api/sources/:id/cards", request: z.undefined(), response: CardRequestResponse },
} as const;
