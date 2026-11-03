import { useEffect, type ReactElement, type ReactNode } from "react";
import { ROUTE_PATTERNS, routes } from "../../../app-shell/index.js";
import { HelpScreen } from "../../../screens/help/index.js";
import { FOREVER_MS } from "../fetch-stub.js";
import type { GalleryView } from "../gallery-views.js";

// One step a gallery view takes for the person after the screen loads: press the button or radio with these words, or type into
// the field with this label.
export type PressStep = { press: string } | { type: string; into: string };

// How long each step waits before it runs, in ms, so the stubbed replies of the step before have arrived.
const STEP_WAIT_MS = 300;

// The first button, link or label on the page whose words or accessible name are these words.
function findTarget(words: string): HTMLElement | undefined {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>("button, a, label"));
  return candidates.find((element) => element.getAttribute("aria-label") === words || (element.textContent ?? "").trim() === words);
}

// Types into the field inside the label with these words, the way React hears a person typing.
function typeInto(label: string, text: string): void {
  const field = findTarget(label)?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
  if (field === undefined || field === null) return;
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, text);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

// Runs one step.
function runStep(step: PressStep): void {
  if ("press" in step) {
    findTarget(step.press)?.click();
    return;
  }
  typeInto(step.into, step.type);
}

// Wraps a screen and takes the given steps after it loads, so the gallery can show a state that only a tap reaches.
export const AfterSteps = (props: { steps: readonly PressStep[]; children: ReactNode }): ReactElement => {
  useEffect(() => {
    const timers = props.steps.map((step, index) =>
      setTimeout(() => {
        runStep(step);
      }, STEP_WAIT_MS * (index + 1)),
    );
    return () => {
      timers.forEach((timer) => {
        clearTimeout(timer);
      });
    };
  }, [props.steps]);
  return <>{props.children}</>;
};

// The problem the help views type in.
const PROBLEM = "Our deploys fail at night and nobody knows why.";
// The steps that type a problem and send it.
const SEND_STEPS: readonly PressStep[] = [{ type: PROBLEM, into: "Your problem" }, { press: "Find who could help" }];

// The Find help page: the empty problem box, a problem that is too short, the search being sent, and the daily limit reached.
export const views: readonly GalleryView[] = [
  { name: "help-ready", title: "Find help, the empty problem box", pattern: ROUTE_PATTERNS.help, url: "/help", element: <HelpScreen /> },
  {
    name: "help-too-short",
    title: "Find help, a problem under 5 characters",
    pattern: ROUTE_PATTERNS.help,
    url: "/help",
    element: (
      <AfterSteps steps={[{ type: "Hm?", into: "Your problem" }, { press: "Find who could help" }]}>
        <HelpScreen />
      </AfterSteps>
    ),
  },
  {
    name: "help-sending",
    title: "Find help, the problem being sent",
    pattern: ROUTE_PATTERNS.help,
    url: "/help",
    element: (
      <AfterSteps steps={SEND_STEPS}>
        <HelpScreen />
      </AfterSteps>
    ),
    stubs: [{ route: routes.asks.createAsk, replies: { status: 201, body: { askId: "00000000-0000-4000-8000-000000000501" }, delayMs: FOREVER_MS } }],
  },
  {
    name: "help-limit",
    title: "Find help, the daily limit reached",
    pattern: ROUTE_PATTERNS.help,
    url: "/help",
    element: (
      <AfterSteps steps={SEND_STEPS}>
        <HelpScreen />
      </AfterSteps>
    ),
    stubs: [{ route: routes.asks.createAsk, replies: { status: 429, body: { code: "help_daily_cap", message: "You have used today's help searches. Try again tomorrow." } } }],
  },
];
