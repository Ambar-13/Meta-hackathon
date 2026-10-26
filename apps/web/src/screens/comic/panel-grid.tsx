import { useEffect, useState, type ReactElement } from "react";
import type { ComicView } from "@meet-first/contracts";

// The width from which the grid shows two columns: 640 px, the same breakpoint the upload screen uses (comic spec 4.8).
export const TWO_COLUMN_QUERY = "(min-width: 640px)";
// The pixel size of each panel, which the image elements declare so the layout does not jump (D64).
const PANEL_PX = 1024;

// The number of grid columns for the current width: two from 640 px, one below it.
export function useColumnCount(): 1 | 2 {
  const [query] = useState(() => window.matchMedia(TWO_COLUMN_QUERY));
  const [isWide, setWide] = useState(query.matches);
  useEffect(() => {
    const onChange = (): void => {
      setWide(query.matches);
    };
    query.addEventListener("change", onChange);
    return () => {
      query.removeEventListener("change", onChange);
    };
  }, [query]);
  return isWide ? 2 : 1;
}

// The six panels in reading order: each image has its caption as its alt text, and no name or badge (R11.3).
export const PanelGrid = (props: { panels: ComicView["panels"] }): ReactElement => {
  const columns = useColumnCount();
  return (
    <ol style={{ display: "grid", gridTemplateColumns: `repeat(${String(columns)}, minmax(0, 1fr))`, gap: "12px", listStyle: "none", margin: 0, padding: 0 }}>
      {props.panels.map((panel) => (
        <li key={panel.position}>
          <img src={panel.imageUrl} alt={panel.caption} width={PANEL_PX} height={PANEL_PX} style={{ display: "block", width: "100%", height: "auto" }} />
          <p>{panel.caption}</p>
        </li>
      ))}
    </ol>
  );
};
