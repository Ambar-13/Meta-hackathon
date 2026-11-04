import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { MyListing } from "@meet-first/contracts";
import { APP_PATHS, clearClientState, ROUTE_PATTERNS, routes } from "../../app-shell/index.js";
import { renderScreen, requestsTo, stubRoute, type StubInput } from "../../testing/index.js";
import { unlabelledControls } from "../../testing/render-screen.js";
import { IDS, LISTING_IDS, SERVER_NOW } from "../../testing/fixtures.js";
import { CreateScreen } from "./screen.js";

// The browser's drawing of a picture, which jsdom cannot do: a picture file gives a small JPEG
// marked with the shape it was drawn for, any other file the error the browser gives for a file it
// cannot draw; the base64 of a drawn JPEG names its shape too.
const drawn = vi.hoisted(() => ({ shapes: [] as string[], shapeOf: new Map<Blob, string>() }));
vi.mock("../me/photo-file.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../me/photo-file.js")>();
  const draw =
    (shape: string) =>
    (file: Blob): Promise<Blob> => {
      drawn.shapes.push(shape);
      if (!file.type.startsWith("image/"))
        return Promise.reject(new original.PhotoFileError("not a picture"));
      const jpeg = new Blob([shape], { type: "image/jpeg" });
      drawn.shapeOf.set(jpeg, shape);
      return Promise.resolve(jpeg);
    };
  return {
    ...original,
    postJpeg: draw("square"),
    storyJpeg: draw("whole"),
    base64Of: (blob: Blob): Promise<string> => Promise.resolve(btoa(drawn.shapeOf.get(blob) ?? "")),
  };
});

beforeEach(() => {
  clearClientState();
  drawn.shapes.length = 0;
  URL.createObjectURL = (): string => "blob:drawn-photo";
  URL.revokeObjectURL = (): void => undefined;
});

afterEach(() => {
  cleanup();
});

// GET /api/directory/me for a person with no listing.
const NOT_LISTED: StubInput = {
  status: 404,
  body: { code: "not_listed", message: "You are not in Explore yet." },
};
// The person's own listing.
const LISTED = MyListing.parse({
  listingId: LISTING_IDS.mine,
  cardId: IDS.card,
  line: "Builds hackathon tools",
  openToRomance: false,
  items: [],
  createdAt: SERVER_NOW,
});
// The id POST /api/posts gives the new post.
const NEW_POST = "00000000-0000-4000-8000-000000000741";

// Renders Create at this address, with the person in Explore or not.
function renderCreate(options: { search?: string; isListed?: boolean } = {}): void {
  stubRoute(routes.directory.readMyListing, options.isListed === false ? NOT_LISTED : LISTED);
  renderScreen(<CreateScreen />, {
    pattern: ROUTE_PATTERNS.create,
    url: `${APP_PATHS.create}${options.search ?? ""}`,
  });
}

// Chooses one file in the photo picker.
function choose(file: File): void {
  const input = document.querySelector<HTMLInputElement>("input[type=file]");
  if (input === null) throw new Error("no photo picker");
  fireEvent.change(input, { target: { files: [file] } });
}

describe("Create, against the MSW route stubs (a fake server)", () => {
  it("W7-CREATE-T1: Create opens on Post with Share waiting for words or a photo; words alone go up trimmed as a post, then Create goes to Home", async () => {
    stubRoute(routes.social.createPost, {
      status: 201,
      body: { postId: NEW_POST, kind: "post", expiresAt: null },
    });
    renderCreate();

    expect(screen.getByRole("heading", { level: 1, name: "New post" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Post" }).getAttribute("aria-pressed")).toBe("true");
    const share = screen.getByRole("button", { name: "Share" });
    expect(share.hasAttribute("disabled")).toBe(true);
    expect(
      screen.getByText("Your Meety learns from your chats and your AI's summary of you."),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Invite a friend instead" }).getAttribute("href")).toBe(
      "/pair",
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Caption" }), {
      target: { value: "  Shipping the stories row tonight.  " },
    });
    fireEvent.click(share);

    await waitFor(() => {
      expect(requestsTo(routes.social.createPost)[0]?.body).toEqual({
        kind: "post",
        text: "Shipping the stories row tonight.",
        photo: null,
      });
    });
    expect((await screen.findByTestId("location")).textContent).toBe("/home");
    expect(unlabelledControls(document.body)).toEqual([]);
  });

  it("W7-CREATE-T2: ?kind=story opens on Story; a photo is drawn whole for a story and again as a square once Post is chosen, and Share sends the square", async () => {
    stubRoute(routes.social.createPost, {
      status: 201,
      body: { postId: NEW_POST, kind: "post", expiresAt: null },
    });
    renderCreate({ search: "?kind=story" });

    expect(screen.getByRole("heading", { level: 1, name: "New story" })).toBeTruthy();
    expect(screen.getByText("Your story shows for 24 hours, then it is gone.")).toBeTruthy();
    choose(new File(["picture"], "sunrise.jpg", { type: "image/jpeg" }));
    expect(await screen.findByRole("img", { name: "Your photo" })).toBeTruthy();
    expect(drawn.shapes).toEqual(["whole"]);
    fireEvent.click(screen.getByRole("button", { name: "Post" }));
    await waitFor(() => {
      expect(drawn.shapes).toEqual(["whole", "square"]);
      expect(screen.getByRole("button", { name: "Share" }).hasAttribute("disabled")).toBe(false);
    });
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() => {
      expect(requestsTo(routes.social.createPost)[0]?.body).toEqual({
        kind: "post",
        text: "",
        photo: btoa("square"),
      });
    });
  });

  it("W7-CREATE-T3: a story goes to Home; a file that is not a picture says so; Remove photo takes the photo away; not in Explore, a post says only you see it and Create goes to your Posts tab", async () => {
    stubRoute(routes.social.createPost, [
      { status: 201, body: { postId: NEW_POST, kind: "post", expiresAt: null } },
    ]);
    renderCreate({ isListed: false });

    expect(await screen.findByText("Only you see your posts until you join Explore.")).toBeTruthy();
    choose(new File(["words"], "notes.txt", { type: "text/plain" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "That file is not a photo this browser can open. Try a JPEG or PNG.",
    );
    choose(new File(["picture"], "desk.png", { type: "image/png" }));
    const photo = await screen.findByRole("img", { name: "Your photo" });
    fireEvent.click(
      within(photo.closest(".create-photo") as HTMLElement).getByRole("button", {
        name: "Remove photo",
      }),
    );
    expect(screen.queryByRole("img", { name: "Your photo" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Caption" }), {
      target: { value: "Not listed yet." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    expect((await screen.findByTestId("location")).textContent).toBe("/me?tab=posts");
  });
});
