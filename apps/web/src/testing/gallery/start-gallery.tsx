import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource-variable/shantell-sans";
import "../../app-shell/app.css";
import "../../app-shell/app-look.css";
import { StickerSheet } from "../../look/index.js";
import { installFetchStub } from "./fetch-stub.js";
import { ALL_VIEWS, PLAY_AFTER_MS, type GalleryView } from "./gallery-views.js";

// Shows where a screen navigated to, when an action leaves the view's route.
const LeftTheScreen = (): ReactElement => {
  const location = useLocation();
  return <p className="gallery-left">{`Went to ${location.pathname}`}</p>;
};

// The list of every view, each a link the screenshot script reads by its data-name.
const GalleryIndex = (): ReactElement => {
  return (
    <main className="screen">
      <h1>Screen gallery</h1>
      <ul>
        {ALL_VIEWS.map((view) => (
          <li key={view.name}>
            <a href={`?view=${view.name}`} data-name={view.name}>
              {view.title}
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
};

// One view on its route, inside a memory router, with its stubs already answering.
const ViewOnRoute = (props: { view: GalleryView }): ReactElement => {
  return (
    <MemoryRouter initialEntries={[props.view.url]}>
      <Routes>
        <Route path={props.view.pattern} element={props.view.element} />
        <Route path="*" element={<LeftTheScreen />} />
      </Routes>
    </MemoryRouter>
  );
};

const viewName = new URLSearchParams(window.location.search).get("view");
const view = ALL_VIEWS.find((candidate) => candidate.name === viewName);
if (view !== undefined) installFetchStub(view.stubs ?? []);
// Each view starts with nothing kept in the browser, so a story watched in one view still shows as
// new in the next.
window.localStorage.clear();
const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <>
      <StickerSheet />
      {view === undefined ? <GalleryIndex /> : <ViewOnRoute view={view} />}
    </>,
  );
  if (view?.play !== undefined) setTimeout(view.play, PLAY_AFTER_MS);
}
