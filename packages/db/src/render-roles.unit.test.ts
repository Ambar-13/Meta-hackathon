import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readRenderInputs, renderFiles, roleProblems, scramSecret, type RoleRow } from "./render-roles.js";

const EXTERNAL_HOST = "dpg-abc123-a.singapore-postgres.render.com";
const INTERNAL_HOST = "dpg-abc123-a";
const OWNER = "meet_first_db_user";
const OWNER_PASSWORD = "owner-secret";
const ORIGIN = "https://meet-first-api.onrender.com";
const PASSWORDS = { app_migrate: "migrate-pw", app_api: "api-pw", app_worker: "worker-pw" };

// A database URL as Render shows one, built through the URL API so that no text in this file pairs a user with a password
// (the secrets job flags such a connection string).
function dbUrl(host: string, options: { user?: string; password?: string; database?: string; query?: string } = {}): string {
  const url = new URL(`postgresql://${host}/${options.database ?? "meet_first_db"}${options.query ?? ""}`);
  url.username = options.user ?? OWNER;
  url.password = options.password ?? OWNER_PASSWORD;
  return url.toString();
}

const EXTERNAL = dbUrl(EXTERNAL_HOST);
const INTERNAL = dbUrl(INTERNAL_HOST);
const GOOD_ENV = { RENDER_DB_EXTERNAL_URL: EXTERNAL, RENDER_DB_INTERNAL_URL: INTERNAL, APP_ORIGIN: ORIGIN };

// The parts of a connection string that a test compares.
function partsOf(text: string | undefined): { user: string; password: string; host: string; database: string; query: string } {
  const url = new URL(text ?? "");
  return { user: url.username, password: url.password, host: url.host, database: url.pathname.slice(1), query: url.search };
}

// The KEY=value lines of one file, as an object.
function valuesOf(text: string | undefined): Record<string, string> {
  const lines = (text ?? "").trim().split("\n");
  return Object.fromEntries(lines.map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
}

// The refusal code a call throws, or "none" when it returns.
function codeOf(run: () => unknown): string {
  try {
    run();
    return "none";
  } catch (error: unknown) {
    return String(Reflect.get(error ?? {}, "code"));
  }
}

// One pg_roles row with the attributes the setup expects for that role.
function goodRow(rolname: string): RoleRow {
  return { rolname, rolsuper: false, rolbypassrls: false, rolcanlogin: rolname !== "app_definer", rolinherit: rolname === "app_migrate", rolcreaterole: false, rolcreatedb: false };
}

describe("render role setup", () => {
  it("W3-DEPLOY-T5: the inputs are refused before any connection when they are missing, mixed up, or not the database's default user", () => {
    expect(readRenderInputs(GOOD_ENV)).toEqual({ externalUrl: EXTERNAL, internalUrl: INTERNAL, appOrigin: ORIGIN, tls: "verify" });
    expect(readRenderInputs({ ...GOOD_ENV, APP_ORIGIN: `${ORIGIN}/` }).appOrigin).toBe(ORIGIN);
    expect(readRenderInputs({ ...GOOD_ENV, RENDER_DB_TLS: "encrypt-only" }).tls).toBe("encrypt-only");

    expect(codeOf(() => readRenderInputs({ RENDER_DB_EXTERNAL_URL: EXTERNAL }))).toBe("render_env_missing");
    expect(codeOf(() => readRenderInputs({ ...GOOD_ENV, RENDER_DB_INTERNAL_URL: INTERNAL_HOST }))).toBe("render_url_invalid");
    expect(codeOf(() => readRenderInputs({ ...GOOD_ENV, RENDER_DB_INTERNAL_URL: EXTERNAL }))).toBe("render_urls_same_host");
    expect(codeOf(() => readRenderInputs({ ...GOOD_ENV, RENDER_DB_INTERNAL_URL: dbUrl(INTERNAL_HOST, { database: "other_db" }) }))).toBe("render_urls_disagree");
    expect(codeOf(() => readRenderInputs({ ...GOOD_ENV, RENDER_DB_INTERNAL_URL: dbUrl(INTERNAL_HOST, { password: "other" }) }))).toBe("render_urls_disagree");
    const asApi = { RENDER_DB_EXTERNAL_URL: dbUrl(EXTERNAL_HOST, { user: "app_api" }), RENDER_DB_INTERNAL_URL: dbUrl(INTERNAL_HOST, { user: "app_api" }) };
    expect(codeOf(() => readRenderInputs({ ...GOOD_ENV, ...asApi }))).toBe("render_url_not_owner");
    expect(codeOf(() => readRenderInputs({ ...GOOD_ENV, RENDER_DB_EXTERNAL_URL: EXTERNAL.replace("postgresql:", "mysql:") }))).toBe("render_url_not_postgres");
    expect(codeOf(() => readRenderInputs({ ...GOOD_ENV, APP_ORIGIN: "http://meet-first-api.onrender.com" }))).toBe("render_origin_not_https");
    expect(codeOf(() => readRenderInputs({ ...GOOD_ENV, APP_ORIGIN: `${ORIGIN}/api` }))).toBe("render_origin_not_https");
    // Plain text is only for a Postgres on this machine, and RENDER_DB_TLS takes one value.
    expect(codeOf(() => readRenderInputs({ ...GOOD_ENV, RENDER_DB_EXTERNAL_URL: dbUrl(EXTERNAL_HOST, { query: "?sslmode=disable" }) }))).toBe("render_tls_plain_remote");
    expect(codeOf(() => readRenderInputs({ ...GOOD_ENV, RENDER_DB_TLS: "off" }))).toBe("render_tls_setting_unknown");
    const local = { RENDER_DB_EXTERNAL_URL: dbUrl("127.0.0.1:55432", { query: "?sslmode=disable" }), RENDER_DB_INTERNAL_URL: dbUrl("localhost:55432") };
    expect(readRenderInputs({ ...GOOD_ENV, ...local }).tls).toBe("plain");
  });

  it("W3-DEPLOY-T6: the files hold each role's URL on the internal host for Render, the worker's on the external host for check-wave-3, and never the owner", () => {
    const files = renderFiles(readRenderInputs(GOOD_ENV), PASSWORDS);

    expect(Object.keys(files)).toEqual([".env.render-api", ".env.render-worker", ".env.wave3"]);
    const api = valuesOf(files[".env.render-api"]);
    expect(Object.keys(api)).toEqual(["DATABASE_URL_MIGRATE", "DATABASE_URL_API", "APP_ORIGIN"]);
    expect(partsOf(api.DATABASE_URL_MIGRATE)).toEqual({ user: "app_migrate", password: "migrate-pw", host: INTERNAL_HOST, database: "meet_first_db", query: "" });
    expect(partsOf(api.DATABASE_URL_API)).toEqual({ user: "app_api", password: "api-pw", host: INTERNAL_HOST, database: "meet_first_db", query: "" });
    expect(api.APP_ORIGIN).toBe(ORIGIN);
    const worker = valuesOf(files[".env.render-worker"]);
    expect(Object.keys(worker)).toEqual(["DATABASE_URL_WORKER"]);
    expect(partsOf(worker.DATABASE_URL_WORKER)).toEqual({ user: "app_worker", password: "worker-pw", host: INTERNAL_HOST, database: "meet_first_db", query: "" });
    const wave3 = valuesOf(files[".env.wave3"]);
    expect(Object.keys(wave3)).toEqual(["APP_ORIGIN", "DATABASE_URL_WORKER"]);
    expect(wave3.APP_ORIGIN).toBe(ORIGIN);
    expect(partsOf(wave3.DATABASE_URL_WORKER)).toEqual({ user: "app_worker", password: "worker-pw", host: EXTERNAL_HOST, database: "meet_first_db", query: "?sslmode=require" });
    // check-wave-3.sh reads LLM_MODE from the deployment, so the file never sets it.
    expect(files[".env.wave3"]).not.toContain("LLM_MODE");
    for (const text of Object.values(files)) {
      expect(text).not.toContain(OWNER_PASSWORD);
      expect(text).not.toContain(OWNER);
    }
  });

  it("W3-DEPLOY-T7: the SCRAM secret for RFC 7677's password and salt verifies that RFC's client proof and gives its server signature", () => {
    // RFC 7677 section 3: user "user", password "pencil", 4096 iterations.
    const salt = Buffer.from("W22ZaJ0SNY7soEsUEjb6gQ==", "base64");
    const authMessage = [
      "n=user,r=rOprNGfwEbeRWgbNEkqO",
      "r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096",
      "c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0",
    ].join(",");
    const clientProof = Buffer.from("dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=", "base64");

    const secret = scramSecret("pencil", salt);
    const match = /^SCRAM-SHA-256\$4096:([^$]+)\$([^:]+):(.+)$/.exec(secret);
    expect(match?.[1]).toBe("W22ZaJ0SNY7soEsUEjb6gQ==");
    const storedKey = Buffer.from(match?.[2] ?? "", "base64");
    const serverKey = Buffer.from(match?.[3] ?? "", "base64");

    // The server's check (RFC 5802 section 3): the client key recovered from the proof must hash to the stored key.
    const clientSignature = createHmac("sha256", storedKey).update(authMessage).digest();
    const clientKey = Buffer.from(clientProof.map((byte, index) => byte ^ (clientSignature[index] ?? 0)));
    expect(createHash("sha256").update(clientKey).digest().equals(storedKey)).toBe(true);
    expect(createHmac("sha256", serverKey).update(authMessage).digest("base64")).toBe("6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=");
    // A fresh salt each call, so two roles with one password would still get different secrets.
    expect(scramSecret("pencil")).not.toBe(scramSecret("pencil"));
  });

  it("W3-DEPLOY-T8: roleProblems passes the expected roles and names each role that could skip row security, log in wrongly or inherit", () => {
    const good = ["app_migrate", "app_api", "app_worker", "app_definer"].map(goodRow);
    expect(roleProblems(good)).toEqual([]);

    const bad = [
      { ...goodRow("app_migrate"), rolbypassrls: true },
      { ...goodRow("app_api"), rolinherit: true },
      { ...goodRow("app_worker"), rolcreaterole: true },
      { ...goodRow("app_definer"), rolcanlogin: true },
    ];
    expect(roleProblems(bad)).toEqual([
      "app_migrate can skip row security",
      "app_api inherits the rights of the roles it belongs to",
      "app_worker may create roles or databases",
      "app_definer can log in",
    ]);
    expect(roleProblems(good.slice(0, 3))).toEqual(["app_definer is missing"]);
  });
});
