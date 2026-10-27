import { ROUTE_PATTERNS, routes } from "../../../app-shell/index.js";
import { SettingsScreen } from "../../../screens/settings/index.js";
import { TRANSFER_TOKEN } from "../../fixtures.js";
import { FOREVER_MS, type GalleryStub } from "../fetch-stub.js";
import type { GalleryView } from "../gallery-views.js";
import { ScriptedSteps, type GalleryStep } from "./friends.js";

// The one-time link the transfer route answers with.
const TRANSFER_REPLY = { url: `http://localhost:3000/claim#${TRANSFER_TOKEN}`, expiresAt: "2026-10-27T10:10:00.000Z" };
// The deletion id the delete route answers with.
const DELETION_ID = "00000000-0000-4000-8000-000000000301";
// The steps that open the delete dialog, and that confirm it; the dialog's button is the last one with these words.
const OPEN_DIALOG: readonly GalleryStep[] = [{ click: "Delete my account" }];
const CONFIRM_DELETE: readonly GalleryStep[] = [{ click: "Delete my account" }, { click: "Delete my account" }];
const MAKE_LINK: readonly GalleryStep[] = [{ click: "Make a Safari link" }];

// One view of the settings page on its route, playing these steps.
function settingsView(head: { name: string; title: string }, stubs: GalleryStub[], steps: readonly GalleryStep[] = []): GalleryView {
  return { ...head, pattern: ROUTE_PATTERNS.settings, url: "/settings", element: <ScriptedSteps steps={steps}><SettingsScreen /></ScriptedSteps>, stubs };
}

// The settings page: at rest, the one-time link being made, made and failed, and the delete flow from the dialog to the notice.
export const views: readonly GalleryView[] = [
  settingsView({ name: "settings-ready", title: "Settings, at rest" }, []),
  settingsView({ name: "settings-link-making", title: "Settings, making the one-time link" }, [{ route: routes.people.transfer, replies: { status: 200, body: TRANSFER_REPLY, delayMs: FOREVER_MS } }], MAKE_LINK),
  settingsView({ name: "settings-link-made", title: "Settings, the one-time link with its copy button" }, [{ route: routes.people.transfer, replies: { status: 200, body: TRANSFER_REPLY } }], MAKE_LINK),
  settingsView({ name: "settings-link-failed", title: "Settings, the one-time link failed" }, [], MAKE_LINK),
  settingsView({ name: "settings-delete-dialog", title: "Settings, the delete dialog" }, [], OPEN_DIALOG),
  settingsView({ name: "settings-deleting", title: "Settings, deleting" }, [{ route: routes.people.deleteMe, replies: { status: 202, body: { deletionId: DELETION_ID }, delayMs: FOREVER_MS } }], CONFIRM_DELETE),
  settingsView({ name: "settings-delete-failed", title: "Settings, the delete failed" }, [{ route: routes.people.deleteMe, replies: { status: 500, body: { code: "internal", message: "The server could not finish this." } } }], CONFIRM_DELETE),
  settingsView({ name: "settings-deleted", title: "Settings, the deleted notice" }, [{ route: routes.people.deleteMe, replies: { status: 202, body: { deletionId: DELETION_ID } } }], CONFIRM_DELETE),
];
