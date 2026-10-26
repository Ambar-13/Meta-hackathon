import { z } from "zod";

// One error shape for every refusal: a stable code and a sentence that says what to do next (repo rule 3).
export class ContractError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, sentence: string, httpStatus = 400) {
    super(sentence);
    this.name = "ContractError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}
// The JSON body every route error sends.
export const ErrorBody = z.object({ code: z.string(), message: z.string() });
// The status codes the routes use, keyed by what happened, so no route invents its own (IMPLEMENTATION.md 2.2).
export const HTTP = {
  badRequest: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
  payloadTooLarge: 413,
  unprocessable: 422,
  tooMany: 429,
  internal: 500,
} as const;
