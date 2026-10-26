import type { ReactElement } from "react";
import { BRIEF_SECTION_LABELS, type ShareSnapshot } from "@meet-first/contracts";
import { SafeMarkdown } from "../../transcript/index.js";

// The three sections of the brief, in the order the page shows them; each one's heading follows the meeting's question kind.
const BRIEF_SECTIONS = ["agree", "clash", "decideFirst"] as const;

// The style of one panel image: never wider than its column, so the page has no sideways scroll at 375 px.
const PANEL_IMAGE_STYLE = { display: "block", maxWidth: "100%", height: "auto" } as const;
// The grid of comic panels: one column on a phone, more where the width allows (640 px and up).
const PANEL_GRID_STYLE = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))", gap: 16, listStyle: "none", padding: 0 } as const;

// The side letter in capitals, as the page labels a member: "A: name".
function labelOf(side: "a" | "b", displayName: string): string {
  return `${side.toUpperCase()}: ${displayName}`;
}

// The people who met and each person's approved items, with their quote chips.
const PeopleSection = (props: { snapshot: ShareSnapshot }): ReactElement => {
  const { snapshot } = props;
  return (
    <section>
      <h2>Who met</h2>
      {snapshot.people.map((person) => (
        <div key={person.side}>
          <p>{labelOf(person.side, person.displayName)}</p>
          <ul>
            {snapshot.items
              .filter((item) => item.side === person.side)
              .map((item, index) => (
                <li key={`${person.side}-${String(index)}`}>
                  <strong>{item.kind}</strong> {item.claim} <q>{item.quote}</q>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
};

// The turns in order: the side and name, the turn text through the safe renderer, and the verified claims as quote chips.
const TurnsSection = (props: { snapshot: ShareSnapshot }): ReactElement => {
  const { snapshot } = props;
  return (
    <section>
      <h2>What the personas said</h2>
      {snapshot.turns.map((turn, index) => {
        const person = snapshot.people.find((member) => member.side === turn.side);
        return (
          <article key={`turn-${String(index)}`}>
            <p>{labelOf(turn.side, person?.displayName ?? "")}</p>
            <SafeMarkdown text={turn.text} />
            <ul aria-label="Verified claims" style={{ listStyle: "none", padding: 0 }}>
              {turn.claims.map((claim, claimIndex) => (
                <li key={`claim-${String(claimIndex)}`}>
                  <q>{claim.quote}</q>
                </li>
              ))}
            </ul>
          </article>
        );
      })}
    </section>
  );
};

// The brief: three sections of supported lines, each line with its quotes. The snapshot already holds only shareable lines.
const BriefSection = (props: { snapshot: ShareSnapshot }): ReactElement => {
  const { snapshot } = props;
  return (
    <section>
      <h2>The brief, lines the support check backed</h2>
      {BRIEF_SECTIONS.map((section) => (
        <div key={section}>
          <h3>{BRIEF_SECTION_LABELS[snapshot.questionKind][section]}</h3>
          <ul>
            {snapshot.brief[section].map((line, index) => (
              <li key={`${section}-${String(index)}`}>
                <p>{line.text}</p>
                {line.quotes.map((quote, quoteIndex) => (
                  <q key={`${section}-${String(index)}-${String(quoteIndex)}`}>{quote.text}</q>
                ))}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
};

// The comic panels, each image with its caption as its alt text, when the snapshot carries a comic.
const ComicSection = (props: { snapshot: ShareSnapshot }): ReactElement | null => {
  const { comic } = props.snapshot;
  if (comic === undefined) return null;
  return (
    <section>
      <h2>The comic</h2>
      <ol style={PANEL_GRID_STYLE}>
        {comic.map((panel, index) => (
          <li key={`panel-${String(index)}`}>
            <figure style={{ margin: 0 }}>
              <img src={panel.imageUrl} alt={panel.caption} style={PANEL_IMAGE_STYLE} />
              <figcaption>{panel.caption}</figcaption>
            </figure>
          </li>
        ))}
      </ol>
    </section>
  );
};

// The public snapshot below the question heading: people, turns, brief and comic. It shows display names only.
export const SnapshotView = (props: { snapshot: ShareSnapshot }): ReactElement => {
  return (
    <>
      <PeopleSection snapshot={props.snapshot} />
      <TurnsSection snapshot={props.snapshot} />
      <BriefSection snapshot={props.snapshot} />
      <ComicSection snapshot={props.snapshot} />
    </>
  );
};
