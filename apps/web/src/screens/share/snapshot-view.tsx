import type { ReactElement } from "react";
import { BRIEF_SECTION_LABELS, type ShareSnapshot } from "@meet-first/contracts";
import { Avatar, EmptyState, NameTag, Receipt, Sticker } from "../../look/index.js";
import { KIND_LABELS } from "../card/index.js";
import { SafeMarkdown } from "../../transcript/index.js";

// The three sections of the brief, in the order the page shows them; each one's heading follows the meeting's question kind.
const BRIEF_SECTIONS = ["agree", "clash", "decideFirst"] as const;
// The colour of each brief section's panel: green where you agree, yellow where you clash, lilac for what to settle first.
const SECTION_COLOUR = { agree: "c-green", clash: "c-yellow", decideFirst: "c-lilac" } as const;

// The style of one panel image: never wider than its column, so the page has no sideways scroll at 375 px. The share test reads
// this inline max-width (W2-SHARE-T15), so it stays; share.css sets the same rule (request design-share-001).
const PANEL_IMAGE_STYLE = { maxWidth: "100%" } as const;

// The words of the page that no input gives [confirm] (drafted copy, design pass).
const SNAPSHOT_COPY = {
  noItems: "No card items were approved for this page.",
  noTurnsTitle: "Nothing said yet",
  noTurns: "The Meetys' turns are not on this page.",
  noLines: "No line in this part passed the support check.",
} as const;

// The side letter in capitals, as the page labels a member: "A: name".
function labelOf(side: "a" | "b", displayName: string): string {
  return `${side.toUpperCase()}: ${displayName}`;
}

// The display name of one side, or an empty string when the snapshot does not hold it.
function nameOf(snapshot: ShareSnapshot, side: "a" | "b"): string {
  return snapshot.people.find((person) => person.side === side)?.displayName ?? "";
}

// The two name tags at the top of the page, over the sky, side a in coral and side b in blue.
export const SnapshotTags = (props: { snapshot: ShareSnapshot }): ReactElement => {
  return (
    <div className="share-duel share-page-tags" aria-hidden="true">
      <NameTag name={nameOf(props.snapshot, "a")} colour="coral" className="share-tag-a" />
      <span className="share-and">&amp;</span>
      <NameTag name={nameOf(props.snapshot, "b")} colour="blue" className="share-tag-b" />
    </div>
  );
};

// The people who met and each person's approved items, each item with its quote.
const PeopleSection = (props: { snapshot: ShareSnapshot }): ReactElement => {
  const { snapshot } = props;
  return (
    <section className="share-section">
      <h2>Who met</h2>
      <div className="share-people">
        {snapshot.people.map((person) => {
          const items = snapshot.items.filter((item) => item.side === person.side);
          return (
            <div key={person.side} className={`share-person side-${person.side}`}>
              <p className="share-person-name">
                <Avatar name={person.displayName} side={person.side} />
                <span>{labelOf(person.side, person.displayName)}</span>
              </p>
              {items.length === 0 ? <p className="muted">{SNAPSHOT_COPY.noItems}</p> : null}
              <ul className="share-items">
                {items.map((item, index) => (
                  <li key={`${person.side}-${String(index)}`}>
                    <p>
                      <span className="chip">{KIND_LABELS[item.kind]}</span> {item.claim}
                    </p>
                    <Receipt quote={item.quote} source={`${person.displayName}, approved card`} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
};

// The turns in order as two voices: side a in coral on the left, side b in blue on the right, each turn with its verified claims.
const TurnsSection = (props: { snapshot: ShareSnapshot }): ReactElement => {
  const { snapshot } = props;
  return (
    <section className="share-section">
      <h2>What the Meetys said</h2>
      {snapshot.turns.length === 0 ? (
        <EmptyState sticker="chat" title={SNAPSHOT_COPY.noTurnsTitle}>
          {SNAPSHOT_COPY.noTurns}
        </EmptyState>
      ) : null}
      <div className="talk share-talk">
        {snapshot.turns.map((turn, index) => {
          const name = nameOf(snapshot, turn.side);
          return (
            <article key={`turn-${String(index)}`} className={`msg ${turn.side}`}>
              <Avatar name={name} side={turn.side} />
              <div className="bubble">
                <span className="who">{`${name}'s Meety`}</span>
                <SafeMarkdown text={turn.text} />
              </div>
              <ul className="extra share-claims" aria-label="Verified claims">
                {turn.claims.map((claim, claimIndex) => (
                  <li key={`claim-${String(claimIndex)}`}>
                    <Receipt quote={claim.quote} source={claim.text} />
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
    </section>
  );
};

// The brief: three colour panels of supported lines, each line with its quotes. The snapshot already holds only shareable lines.
const BriefSection = (props: { snapshot: ShareSnapshot }): ReactElement => {
  const { snapshot } = props;
  return (
    <section className="share-section">
      <h2>
        The brief, lines the support check backed <Sticker name="quote" />
      </h2>
      {BRIEF_SECTIONS.map((section) => (
        <div key={section} className={`colour-panel ${SECTION_COLOUR[section]} share-part share-part-${section}`}>
          <h3>{BRIEF_SECTION_LABELS[snapshot.questionKind][section]}</h3>
          {snapshot.brief[section].length === 0 ? <p className="share-none">{SNAPSHOT_COPY.noLines}</p> : null}
          <ul className="share-lines">
            {snapshot.brief[section].map((line, index) => (
              <li key={`${section}-${String(index)}`}>
                <p>{line.text}</p>
                <div className="share-receipts">
                  {line.quotes.map((quote, quoteIndex) => (
                    <Receipt key={`${section}-${String(index)}-${String(quoteIndex)}`} quote={quote.text} source={`From ${nameOf(snapshot, quote.side)}'s side`} />
                  ))}
                </div>
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
    <section className="share-section">
      <h2>The comic</h2>
      <ol className="share-comic">
        {comic.map((panel, index) => (
          <li key={`panel-${String(index)}`}>
            <figure>
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
