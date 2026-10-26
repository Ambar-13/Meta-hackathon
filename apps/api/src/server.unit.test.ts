import { Writable } from "node:stream";
import { expect, it } from "vitest";
import { pino } from "pino";
import { ContractError } from "@meet-first/contracts";
import { loggerOptions, readApiEnv } from "./server.js";

it("R10.2-T1: readApiEnv names every missing variable and stops boot with api_env_invalid", () => {
  let thrown: unknown;
  try {
    readApiEnv({});
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(ContractError);
  expect(thrown).toMatchObject({ code: "api_env_invalid", httpStatus: 500, message: "Set APP_ORIGIN, DATABASE_URL_API in the environment, then start the api again." });

  const env = readApiEnv({ DATABASE_URL_API: "postgres://app_api:x@localhost:5432/meet_first", APP_ORIGIN: "http://localhost:3000" });

  expect(env.PORT).toBe(3000);
  expect(env.MAX_CONCURRENT_MEETINGS).toBe(40);
  expect(env.LOG_LEVEL).toBe("info");
});

it("A7-T9: the logger hides the cookie, set-cookie and token fields (invariant 21)", () => {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, encoding, callback) {
      lines.push(String(chunk));
      callback();
    },
  });
  const logger = pino(loggerOptions("info"), stream);

  logger.info(
    {
      req: { headers: { cookie: "__Host-session=c0ffee" } },
      res: { headers: { "set-cookie": "__Host-session=c0ffee" } },
      body: { token: "t-one", sessionToken: "t-two", recoveryCode: "t-three" },
    },
    "probe",
  );

  expect(lines.length).toBe(1);
  const line = lines[0] ?? "";
  expect(line).toContain("[hidden]");
  expect(line).toContain("probe");
  for (const secret of ["c0ffee", "t-one", "t-two", "t-three"]) {
    expect(line).not.toContain(secret);
  }
});
