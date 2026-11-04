import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AVATARS, type ComicView } from "@meet-first/contracts";
import { APP_PATHS, ROUTE_PATTERNS, routes } from "../../app-shell/index.js";
import { renderScreen, stubRoute } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { IDS } from "../../testing/fixtures.js";
import { ComicScreen, SkippedNotice } from "./screen.js";
import { SKIP_COPY, type ComicSkipReason } from "./comic-state.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// The reply of the comic view when no comic was asked for yet.
const NOT_REQUESTED = {
  status: 404,
  body: { code: "comic_not_found", message: "No comic has been requested for this meeting." },
};
// A comic view in one state, with no panels yet.
const comicIn = (state: ComicView["state"]): ComicView => ({ state, panels: [] });
// Six panels with a caption each, in order.
const CAPTIONS = [
  "A and B sit down to talk.",
  "A and B agree on a plan.",
  "A and B see a difference.",
  "A and B talk it through.",
  "A and B decide together.",
  "A and B settle the first piece.",
];
const READY: ComicView = {
  state: "ready",
  panels: CAPTIONS.map((caption, index) => ({
    position: index + 1,
    caption,
    imageUrl: `/api/comics/${IDS.meeting}/panels/${String(index + 1)}`,
  })),
};

// Renders the comic page for the fixture meeting, at one phone or desktop width.
function renderComic(width: 375 | 1024 = 375): void {
  renderScreen(<ComicScreen />, {
    pattern: ROUTE_PATTERNS.comic,
    url: APP_PATHS.comic(IDS.meeting),
    width,
  });
}

describe("comic screen", () => {
  it("W2-COMIC-T16: the picker is a fieldset with six labelled radios and the button is disabled until one is picked", async () => {
    stubRoute(routes.briefs.readComic, NOT_REQUESTED);
    renderComic();
    const picker = await screen.findByRole("group", { name: "Pick your character" });
    expect(picker.tagName).toBe("FIELDSET");
    const radios = within(picker).getAllByRole("radio");
    expect(radios).toHaveLength(AVATARS.length);
    for (const avatar of AVATARS) expect(screen.getByRole("radio", { name: avatar })).toBeTruthy();
    const draw = screen.getByRole("button", { name: "Draw the comic" });
    expect(draw.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: AVATARS[0] }));
    expect(draw.getAttribute("aria-disabled")).toBe("false");
    expect(unlabelledControls(document.body)).toEqual([]);
  });

  it("W2-COMIC-T17: the rendering copy shows, then six images with alt text equal to captions after the stub flips, using fake timers and says so", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    stubRoute(routes.briefs.readComic, [comicIn("rendering"), READY]);
    renderComic();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Drawing your comic. Up to a minute.")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    const images = screen.getAllByRole("img");
    expect(images).toHaveLength(6);
    images.forEach((image, index) => {
      expect(image.getAttribute("alt")).toBe(CAPTIONS[index]);
    });
  });

  it("W2-COMIC-T18: each skipped reason renders its own sentence and no retry button exists", async () => {
    const reasons: ComicSkipReason[] = [
      "deadline",
      "prompt_blocked",
      "render_failed",
      "no_supported_lines",
    ];
    for (const reason of reasons) {
      const { unmount } = render(<SkippedNotice reason={reason} />);
      expect(screen.getByText(SKIP_COPY[reason])).toBeTruthy();
      expect(screen.queryByRole("button")).toBeNull();
      unmount();
    }
    stubRoute(routes.briefs.readComic, comicIn("skipped"));
    renderComic();
    expect(await screen.findByText("No comic this time.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /again|retry|draw/i })).toBeNull();
    cleanup();
    stubRoute(routes.briefs.readComic, comicIn("failed"));
    renderComic();
    expect(await screen.findByText(SKIP_COPY.render_failed)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /again|retry|draw/i })).toBeNull();
  });

  it("W2-COMIC-T19: one column at 375 px with no horizontal overflow", async () => {
    stubRoute(routes.briefs.readComic, READY);
    renderComic(375);
    const list = await screen.findByRole("list");
    expect(list.style.gridTemplateColumns).toBe("repeat(1, minmax(0, 1fr))");
    for (const image of screen.getAllByRole("img")) {
      expect(image.style.width).toBe("100%");
      expect(image.getAttribute("width")).toBe("1024");
      expect(image.getAttribute("height")).toBe("1024");
    }
    cleanup();
    renderComic(1024);
    const wide = await screen.findByRole("list");
    expect(wide.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
  });
});
