import fastify from "fastify";
import { expect, it } from "vitest";
import { addRenderAddressRedirect, appAddressFor } from "./render-address.js";

const APP_ORIGIN = "https://heymeety.com";
const RENDER_HOST = "meet-first.onrender.com";

it("W7-DOMAIN-T1: a page asked for on the Render address goes to the same path and query on the app's address", () => {
  expect(
    appAddressFor({ method: "GET", host: RENDER_HOST, url: "/people/1?tab=posts" }, APP_ORIGIN),
  ).toBe("https://heymeety.com/people/1?tab=posts");
  expect(appAddressFor({ method: "HEAD", host: RENDER_HOST, url: "/" }, APP_ORIGIN)).toBe(
    "https://heymeety.com/",
  );
  expect(
    appAddressFor({ method: "GET", host: "Meet-First.onrender.com:443", url: "/home" }, APP_ORIGIN),
  ).toBe("https://heymeety.com/home");
});

it("W7-DOMAIN-T2: the api, the build files, other methods, other hosts and a Render APP_ORIGIN stay where they are", () => {
  expect(
    appAddressFor({ method: "GET", host: RENDER_HOST, url: "/api/health" }, APP_ORIGIN),
  ).toBeNull();
  expect(
    appAddressFor({ method: "GET", host: RENDER_HOST, url: "/assets/app-1a2b3c4d.js" }, APP_ORIGIN),
  ).toBeNull();
  expect(
    appAddressFor({ method: "POST", host: RENDER_HOST, url: "/people" }, APP_ORIGIN),
  ).toBeNull();
  expect(
    appAddressFor({ method: "GET", host: "heymeety.com", url: "/home" }, APP_ORIGIN),
  ).toBeNull();
  expect(
    appAddressFor({ method: "GET", host: "localhost:3000", url: "/home" }, APP_ORIGIN),
  ).toBeNull();
  expect(appAddressFor({ method: "GET", host: undefined, url: "/home" }, APP_ORIGIN)).toBeNull();
  expect(
    appAddressFor(
      { method: "GET", host: RENDER_HOST, url: "/home" },
      "https://meet-first.onrender.com",
    ),
  ).toBeNull();
});

it("W7-DOMAIN-T3: the hook answers a page on the Render address with 301 before any route runs, and lets the rest through", async () => {
  const app = fastify();
  addRenderAddressRedirect(app, APP_ORIGIN);
  app.get("/*", () => "page");

  const moved = await app.inject({
    method: "GET",
    url: "/?access=meetfirst-j493y6",
    headers: { host: RENDER_HOST },
  });
  const here = await app.inject({ method: "GET", url: "/home", headers: { host: "heymeety.com" } });
  const api = await app.inject({
    method: "GET",
    url: "/api/health",
    headers: { host: RENDER_HOST },
  });
  await app.close();

  expect([moved.statusCode, moved.headers.location]).toEqual([
    301,
    "https://heymeety.com/?access=meetfirst-j493y6",
  ]);
  expect([here.statusCode, here.body]).toEqual([200, "page"]);
  expect([api.statusCode, api.body]).toEqual([200, "page"]);
});
