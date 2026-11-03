import { useEffect, useState, type ReactElement } from "react";
import type { ComicView } from "@meet-first/contracts";
import { Sticker } from "../../look/index.js";

// The width from which the grid shows two columns: 640 px, the same breakpoint the upload screen uses (comic spec 4.8).
export const TWO_COLUMN_QUERY = "(min-width: 640px)";
// The pixel size of each panel, which the image elements declare so the layout does not jump.
const PANEL_PX = 1024;
// How many empty frames the drawing state shows, one per panel to come.
const DRAWING_FRAMES = 6;

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

// One panel in its frame: the image with its caption as alt text, or, when the image does not load, a note in its place.
const Panel = (props: { panel: ComicView["panels"][number] }): ReactElement => {
  const [hasFailed, setFailed] = useState(false);
  return (
    <li className="comic-frame">
      {hasFailed ? (
        <div className="comic-missing" role="img" aria-label={props.panel.caption}>
          <Sticker name="poof" />
          <span>This panel did not load.</span>
        </div>
      ) : (
        <img
          src={props.panel.imageUrl}
          alt={props.panel.caption}
          width={PANEL_PX}
          height={PANEL_PX}
          style={{ width: "100%" }}
          onError={() => {
            setFailed(true);
          }}
        />
      )}
      <p>{props.panel.caption}</p>
    </li>
  );
};

// The six panels in reading order as tilted photo frames: each image has its caption as its alt text, and no name or badge.
// The column count and the image width stay as style properties because the comic tests read them there (requests/design-pair-001.md).
export const PanelGrid = (props: { panels: ComicView["panels"] }): ReactElement => {
  const columns = useColumnCount();
  return (
    <ol className="comic-grid" style={{ gridTemplateColumns: `repeat(${String(columns)}, minmax(0, 1fr))` }}>
      {props.panels.map((panel) => (
        <Panel key={panel.position} panel={panel} />
      ))}
    </ol>
  );
};

// Six empty frames with the typing dots, shown while the comic is drawing.
export const DrawingFrames = (): ReactElement => {
  return (
    <ol className="comic-grid comic-drawing" aria-hidden="true">
      {Array.from({ length: DRAWING_FRAMES }, (unused, index) => (
        <li key={index} className="comic-frame">
          <span className="comic-blank">
            <span className="typing">
              <i />
              <i />
              <i />
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
};
