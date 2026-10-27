import type { ReactElement } from "react";
import type { GalleryStub } from "./fetch-stub.js";

// One screen in one state: a unique name, a title for the index, the route it renders on, the screen element, the stubbed
// replies it reads, and an optional play step that acts on the page after it renders (for example filling and sending a form).
// Each screen folder's views live in ./views/<screen>.tsx, which exports `views`.
export type GalleryView = {
  name: string;
  title: string;
  pattern: string;
  url: string;
  element: ReactElement;
  stubs?: readonly GalleryStub[];
  play?: () => void;
};

// How long after the first render a view's play step runs, in ms.
export const PLAY_AFTER_MS = 400;

// Types a value into the field with this label text inside a form, the way a person would, for a play step.
export function typeInto(labelText: string, value: string): void {
  const label = Array.from(document.querySelectorAll("label")).find((element) => (element.textContent ?? "").trim().startsWith(labelText));
  const field = label?.control ?? null;
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.value = value;
}

// Presses the button with this exact text, for a play step.
export function press(buttonText: string): void {
  const button = Array.from(document.querySelectorAll("button")).find((element) => (element.textContent ?? "").trim() === buttonText);
  button?.click();
}

// Every views file in ./views, collected at build time, so a new file needs no edit anywhere else.
const MODULES = import.meta.glob<{ views: readonly GalleryView[] }>("./views/*.tsx", { eager: true });

// All gallery views, in file name order and then in the order each file lists them.
export const ALL_VIEWS: readonly GalleryView[] = Object.keys(MODULES)
  .sort()
  .flatMap((key) => MODULES[key]?.views ?? []);
