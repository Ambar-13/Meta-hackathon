import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { DIRECTORY_SWITCH_COPY, FRIENDS_ASK_SWITCH_COPY, LISTING_LINE_MAX_CHARS, ROMANCE_SWITCH_COPY, type CardItem } from "@meet-first/contracts";
import { ErrorNotice } from "../../app-shell/index.js";
import { LoadingLine, Sticker } from "../../look/index.js";
import { KIND_LABELS } from "./card-state.js";
import { PillSwitch } from "./pill-switch.js";
import { directoryPathWithCard, isListedWith, useSharing, type SavedSharing, type SharingDraft, type SharingHook, type SharingStatus } from "./sharing-state.js";

// The words of the Sharing section that no input gives [confirm] (drafted copy).
const SHARING_COPY = {
  loading: "Loading your sharing settings.",
  publicLegend: "Items people in the directory can see",
  lineLabel: "A line about you for the directory (1 to 140 characters)",
  otherCard: "Your persona is listed from another card. Turning the directory switch on here lists this card instead.",
  save: "Save sharing",
  saved: "Sharing saved.",
  openDirectory: "Open the directory",
  datingNote: "Dating is your call. Leave this off if you only want teammates and friends.",
  noPublicItems: "No item can be public yet. Only items in your card with a checked quote can.",
} as const;

// One checkbox per approved item whose quote was found, the only items that may be public (P1).
const PublicItemBoxes = (props: { items: CardItem[]; draft: SharingDraft; onToggle: (position: number) => void }): ReactElement => {
  const shareable = props.items.filter((item) => item.approved && item.verified);
  return (
    <fieldset className="public-items">
      <legend>{SHARING_COPY.publicLegend}</legend>
      {shareable.length === 0 ? <p className="muted">{SHARING_COPY.noPublicItems}</p> : null}
      {shareable.map((item) => (
        <label className="public-item" key={item.id}>
          <input type="checkbox" checked={props.draft.publicPositions.has(item.position)} onChange={() => { props.onToggle(item.position); }} />
          {`${KIND_LABELS[item.kind]}: ${item.claim}`}
        </label>
      ))}
    </fieldset>
  );
};

// The directory switch, the line field and the dating switch. The line and the dating switch work only while the directory switch is on (P2, P8).
const DirectoryControls = (props: { draft: SharingDraft; hook: SharingHook }): ReactElement => {
  const { draft, hook } = props;
  return (
    <>
      <PillSwitch label={DIRECTORY_SWITCH_COPY} isOn={draft.isListed} isDisabled={false} onChange={hook.setListed} />
      <label className="listing-line">
        {SHARING_COPY.lineLabel}
        <input type="text" maxLength={LISTING_LINE_MAX_CHARS} value={draft.line} disabled={!draft.isListed} onChange={(event) => { hook.setLine(event.target.value); }} />
      </label>
      <PillSwitch label={ROMANCE_SWITCH_COPY} isOn={draft.openToRomance} isDisabled={!draft.isListed} onChange={hook.setOpenToRomance} />
      <p className="dating-note">{SHARING_COPY.datingNote}</p>
    </>
  );
};

// The line under the save button: saved, the refusal, or the server's error, and nothing while idle or sending.
const SaveStatus = (props: { status: SharingStatus }): ReactElement | null => {
  const { status } = props;
  if (status.kind === "saved") return <p className="save-line" role="status">{SHARING_COPY.saved}</p>;
  if (status.kind === "refused") return <p className="save-line is-refused" role="alert">{status.sentence}</p>;
  if (status.kind === "failed") return <ErrorNotice error={status.error} />;
  return null;
};

// The controls of a loaded Sharing section, the save button, and the link to the directory with this card.
const SharingForm = (props: { cardId: string; items: CardItem[]; saved: SavedSharing; draft: SharingDraft; hook: SharingHook }): ReactElement => {
  const { cardId, saved, draft, hook } = props;
  const isListedElsewhere = saved.listing !== null && !isListedWith(saved.listing, cardId);
  return (
    <>
      <PillSwitch label={FRIENDS_ASK_SWITCH_COPY} isOn={draft.friendsCanAsk} isDisabled={false} onChange={hook.setFriendsCanAsk} />
      <PublicItemBoxes items={props.items} draft={draft} onToggle={hook.togglePublic} />
      <DirectoryControls draft={draft} hook={hook} />
      {isListedElsewhere ? <p className="soft-panel c-yellow other-card">{SHARING_COPY.otherCard}</p> : null}
      <div className="actions sharing-actions">
        <button type="button" disabled={hook.status.kind === "sending"} onClick={() => void hook.save()}>
          {SHARING_COPY.save}
        </button>
        <Link className="btn quiet" to={directoryPathWithCard(cardId)}>
          {SHARING_COPY.openDirectory}
        </Link>
      </div>
      <SaveStatus status={hook.status} />
    </>
  );
};

// The Sharing section of an approved card: the friends switch, the public items, the directory switch with its line, and the dating
// switch, each off until the person turns it on (design section 7, P1 to P3, P8).
export const SharingSection = (props: { cardId: string; items: CardItem[] }): ReactElement => {
  const hook = useSharing(props.cardId);
  const { load } = hook;
  return (
    <section className="panel sharing" aria-labelledby="sharing-title">
      <div className="sharing-head">
        <h2 id="sharing-title">Sharing</h2>
        <Sticker name="tags" />
      </div>
      <p className="muted sharing-lead">Each switch stays off until you turn it on.</p>
      {load.kind === "loading" ? <LoadingLine text={SHARING_COPY.loading} /> : null}
      {load.kind === "failed" ? <ErrorNotice error={load.error} /> : null}
      {load.kind === "ready" ? <SharingForm cardId={props.cardId} items={props.items} saved={load.saved} draft={load.draft} hook={hook} /> : null}
    </section>
  );
};
