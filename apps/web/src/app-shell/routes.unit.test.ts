import { describe, expect, it } from "vitest";
import { ROUTE_PATTERNS } from "./app-paths.js";
import { APP_ROUTES } from "./routes.js";
import { BriefScreen } from "../screens/brief/index.js";
import { ComicScreen } from "../screens/comic/index.js";
import { ConsentScreen, PublicSharePage } from "../screens/share/index.js";
import { SettingsScreen } from "../screens/settings/index.js";

describe("route table", () => {
  it("R13.1-T1: the route table has one route per ROUTE_PATTERNS entry in order, then the not-found route", () => {
    expect(APP_ROUTES.map((route) => route.path)).toEqual([...Object.values(ROUTE_PATTERNS), "*"]);
  });

  it("R13.1-T2: the five placeholder names exist where routes.tsx imports them", () => {
    expect(typeof BriefScreen).toBe("function");
    expect(typeof ComicScreen).toBe("function");
    expect(typeof ConsentScreen).toBe("function");
    expect(typeof PublicSharePage).toBe("function");
    expect(typeof SettingsScreen).toBe("function");
  });
});
