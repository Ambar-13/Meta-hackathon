import type { ReactElement } from "react";
import type { GalleryStub } from "./fetch-stub.js";

// One screen in one state: a unique name, a title for the index, the route it renders on, the screen element, and the
// stubbed replies it reads. Each screen folder's views live in ./views/<screen>.tsx, which exports `views`.
export type GalleryView = {
  name: string;
  title: string;
  pattern: string;
  url: string;
  element: ReactElement;
  stubs?: readonly GalleryStub[];
};

// Every views file in ./views, collected at build time, so a new file needs no edit anywhere else.
const MODULES = import.meta.glob<{ views: readonly GalleryView[] }>("./views/*.tsx", { eager: true });

// All gallery views, in file name order and then in the order each file lists them.
export const ALL_VIEWS: readonly GalleryView[] = Object.keys(MODULES)
  .sort()
  .flatMap((key) => MODULES[key]?.views ?? []);
