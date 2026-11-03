import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { render, type RenderResult } from "@testing-library/react";
import "./mock-server.js";

// Answers the media queries the screens use at one fixed width.
function fakeMatchMedia(width: number): (query: string) => MediaQueryList {
  return (query: string): MediaQueryList => {
    const maxMatch = /\(max-width: (\d+)px\)/.exec(query);
    const minMatch = /\(min-width: (\d+)px\)/.exec(query);
    let isMatch = false;
    if (maxMatch?.[1] !== undefined) isMatch = width <= Number(maxMatch[1]);
    if (minMatch?.[1] !== undefined) isMatch = width >= Number(minMatch[1]);
    return {
      media: query,
      matches: isMatch,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  };
}

// Shows the path and query the router is on, so a test can read where a screen navigated to.
const LocationProbe = (): ReactElement => {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
};

// Renders one screen inside the app's router at a phone width, with the MSW server running.
export function renderScreen(element: ReactElement, options: { pattern: string; url: string; width?: 375 | 1024 }): RenderResult {
  const width = options.width ?? 375;
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  window.matchMedia = fakeMatchMedia(width);
  return render(
    <MemoryRouter initialEntries={[options.url]}>
      <Routes>
        <Route path={options.pattern} element={element} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

// True when a form control or a link has a name a screen reader can read.
function isLabelled(control: Element): boolean {
  const ariaLabel = control.getAttribute("aria-label") ?? "";
  if (control.tagName === "BUTTON" || control.tagName === "A") {
    return (control.textContent ?? "").trim() !== "" || ariaLabel !== "";
  }
  const labels = (control as HTMLInputElement).labels;
  const hasLabels = labels !== null && labels.length > 0;
  return hasLabels || ariaLabel !== "" || control.getAttribute("aria-labelledby") !== null;
}

// Every input, textarea, select, button and link in a container that has no accessible name; [] means every control is labelled.
export function unlabelledControls(container: ParentNode): string[] {
  const controls = Array.from(container.querySelectorAll("input, textarea, select, button, a[href]"));
  const names: string[] = [];
  controls.forEach((control, index) => {
    const isHidden = control.tagName === "INPUT" && (control as HTMLInputElement).type === "hidden";
    if (!isHidden && !isLabelled(control)) names.push(`${control.tagName.toLowerCase()} ${String(index)}`);
  });
  return names;
}
