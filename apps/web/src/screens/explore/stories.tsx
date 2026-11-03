// The row of stories at the top of Home and the viewer a story opens in, after Instagram's.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import { Link } from "react-router-dom";
import type { StoriesView, Story } from "@meet-first/contracts";
import { APP_PATHS, asApiError, createPath, ErrorNotice, type ApiError, type PolledView } from "../../app-shell/index.js";
import { Icon, PersonAvatar, photoUrl, StoryPicture } from "../../look/index.js";
import { postAgeWords } from "../people/index.js";
import type { ExploreFriends } from "./explore-state.js";
import { deleteShare, readSeen, rememberSeen, storyGroups, type StoryGroup } from "./story-state.js";

// The words of the row and the viewer.
const STORY_COPY = {
  rowLabel: "Stories",
  yours: "Your story",
  addYours: "Add to your story",
  sample: "Sample person",
  previous: "Previous story",
  next: "Next story",
  pause: "Pause",
  play: "Play",
  close: "Close",
  remove: "Delete story",
  confirm: "Delete this story for good?",
  keep: "Keep it",
  removeNow: "Delete",
  profile: "See profile",
} as const;
// How long one story shows before the next, as Instagram's.
const STORY_SHOW_MS = 5_000;

// True when the person asked their system for less motion; then stories wait for a tap instead of moving on by themselves.
function prefersLessMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// One person's face in the row: a dark ring while one of their stories is new to you, a hairline once you have watched them all.
const StoryFace = (props: { group: StoryGroup; onOpen: () => void }): ReactElement => {
  const { group } = props;
  const name = group.isMine ? STORY_COPY.yours : group.displayName;
  return (
    <button type="button" className="story" onClick={props.onOpen} aria-label={group.isSeen ? `${name}, story` : `${name}, new story`}>
      <span className={group.isSeen ? "story-ring is-seen" : "story-ring is-new"}>
        <PersonAvatar name={group.displayName} size="l" photo={group.authorPhoto} isSample={group.isSample} />
      </span>
      <span className="story-name">{name}</span>
    </button>
  );
};

// The row of faces: Your story first, which opens Create ready for a story while you have none and your stories once you do; then each
// person with a story, new ones first. The viewer opens over the page on the face tapped and keeps the row's order as it was then, so
// watching a story never moves the person under it.
export const StoriesRow = (props: { stories: PolledView<StoriesView>; me: { name: string; photo: string | null } | null; friends: ExploreFriends }): ReactElement => {
  const [seen, setSeen] = useState<ReadonlySet<string>>(readSeen);
  const [open, setOpen] = useState<{ groups: StoryGroup[]; at: number } | null>(null);
  const groups = storyGroups(props.stories.value?.stories ?? [], props.friends.isFriend, seen);
  const hasMine = groups[0]?.isMine === true;
  const onSeen = (storyId: string): void => {
    rememberSeen(storyId);
    setSeen(readSeen());
  };
  return (
    <section className="stories" aria-label={STORY_COPY.rowLabel}>
      <ul>
        {hasMine ? null : (
          <li>
            <Link className="story is-you" to={createPath("story")} aria-label={STORY_COPY.addYours}>
              <span className="story-ring">
                <PersonAvatar name={props.me?.name ?? STORY_COPY.yours} size="l" photo={props.me?.photo ?? null} />
                <span className="story-plus" aria-hidden="true"><Icon name="plus" size={14} isBold /></span>
              </span>
              <span className="story-name">{STORY_COPY.yours}</span>
            </Link>
          </li>
        )}
        {groups.map((group, index) => (
          <li key={group.key}>
            <StoryFace group={group} onOpen={() => { setOpen({ groups, at: index }); }} />
          </li>
        ))}
      </ul>
      {open === null ? null : <StoryViewer groups={open.groups} startAt={open.at} onSeen={onSeen} onClose={() => { setOpen(null); }} onDeleted={props.stories.reload} />}
    </section>
  );
};

// Where the viewer is: which person, and which of their stories.
type ViewerPlace = { group: number; story: number };

// The next place after this one: the person's next story, else the next person's first, else null after the last.
function nextPlace(groups: readonly StoryGroup[], place: ViewerPlace): ViewerPlace | null {
  const group = groups[place.group];
  if (group !== undefined && place.story + 1 < group.stories.length) return { group: place.group, story: place.story + 1 };
  return place.group + 1 < groups.length ? { group: place.group + 1, story: 0 } : null;
}

// The place before this one: the person's story before, else the person before's first story, else this same story again.
function previousPlace(place: ViewerPlace): ViewerPlace {
  if (place.story > 0) return { group: place.group, story: place.story - 1 };
  return place.group > 0 ? { group: place.group - 1, story: 0 } : place;
}

// Delete story for your own story, with a second press to be sure; null for anyone else's.
const DeleteStory = (props: { storyId: string; onDeleted: () => void }): ReactElement => {
  const [isAsking, setIsAsking] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const remove = (): void => {
    deleteShare(props.storyId, props.onDeleted).catch((thrown: unknown) => {
      setError(asApiError(thrown));
    });
  };
  return (
    <div className="story-delete">
      {isAsking ? (
        <>
          <span>{STORY_COPY.confirm}</span>
          <button type="button" className="story-chip is-danger" onClick={remove}>{STORY_COPY.removeNow}</button>
          <button type="button" className="story-chip" onClick={() => { setIsAsking(false); }}>{STORY_COPY.keep}</button>
        </>
      ) : (
        <button type="button" className="story-chip" onClick={() => { setIsAsking(true); }}>{STORY_COPY.remove}</button>
      )}
      {error === null ? null : <ErrorNotice error={error} />}
    </div>
  );
};

// The foot of the viewer: Delete story on your own, Add to your story beside it, and See profile on someone else's.
const ViewerFoot = (props: { group: StoryGroup; storyId: string; onDeleted: () => void }): ReactElement | null => {
  const { group } = props;
  if (group.isMine) {
    return (
      <footer className="story-foot">
        <DeleteStory key={props.storyId} storyId={props.storyId} onDeleted={props.onDeleted} />
        <Link className="story-chip" to={createPath("story")}>{STORY_COPY.addYours}</Link>
      </footer>
    );
  }
  if (group.listingId === null) return null;
  return (
    <footer className="story-foot">
      <Link className="story-chip" to={APP_PATHS.person(group.listingId)}>{STORY_COPY.profile}</Link>
    </footer>
  );
};

// The keys the viewer answers: the arrows move, Escape closes, the space bar pauses, and Tab stays inside the viewer.
function onViewerKey(event: KeyboardEvent<HTMLDivElement>, actions: { next: () => void; previous: () => void; close: () => void; togglePause: () => void }): void {
  if (event.key === "ArrowRight") actions.next();
  else if (event.key === "ArrowLeft") actions.previous();
  else if (event.key === "Escape") actions.close();
  else if (event.key === " " && (event.target as HTMLElement).tagName !== "BUTTON" && (event.target as HTMLElement).tagName !== "A") actions.togglePause();
  else if (event.key === "Tab") keepFocusInside(event);
  else return;
  if (event.key !== "Tab") event.preventDefault();
}

// Keeps Tab and Shift+Tab inside the viewer, from its last control back to its first and the other way.
function keepFocusInside(event: KeyboardEvent<HTMLDivElement>): void {
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("button, a[href]")];
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (first === undefined || last === undefined) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

// Runs the viewer's clock: each story moves on after STORY_SHOW_MS of showing, counting only the time it was not paused, so Pause and
// Play pick up where the story was. moveOn is read when the time runs out, so it always moves from where the viewer is then.
function useStoryClock(storyId: string | undefined, isPaused: boolean, moveOn: () => void): void {
  const shown = useRef({ storyId: "", elapsedMs: 0 });
  const latest = useRef(moveOn);
  latest.current = moveOn;
  useEffect(() => {
    if (storyId === undefined) return undefined;
    if (shown.current.storyId !== storyId) shown.current = { storyId, elapsedMs: 0 };
    if (isPaused) return undefined;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => { latest.current(); }, Math.max(0, STORY_SHOW_MS - shown.current.elapsedMs));
    return () => {
      window.clearTimeout(timer);
      shown.current.elapsedMs += Date.now() - startedAt;
    };
  }, [storyId, isPaused]);
}

// While the viewer is open: the page under it does not scroll, the focus starts on Close, and it goes back where it was on closing.
function useViewerFocus(closeRef: { current: HTMLButtonElement | null }): void {
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      opener?.focus();
    };
  }, [closeRef]);
}

// A bar for each of the person's stories: full for the ones watched, filling for the one showing, which stops while paused.
const StoryBars = (props: { group: StoryGroup; at: number; isPaused: boolean }): ReactElement => {
  return (
    <div className="story-bars" aria-hidden="true">
      {props.group.stories.map((item, index) => (
        <span key={item.storyId} className={index < props.at ? "story-bar is-done" : "story-bar"}>
          {index === props.at ? <i className={props.isPaused ? "story-bar-fill is-paused" : "story-bar-fill"} /> : null}
        </span>
      ))}
    </div>
  );
};

// The head of the viewer: the person's face and name, how long ago the story went up (Sample person for a sample's), Pause or Play, and
// Close.
const ViewerHead = (props: { group: StoryGroup; story: Story; isPaused: boolean; onPause: () => void; onClose: () => void; closeRef: { current: HTMLButtonElement | null } }): ReactElement => {
  const { group, story } = props;
  return (
    <header className="story-head">
      <PersonAvatar name={group.displayName} size="s" photo={group.authorPhoto} isSample={group.isSample} />
      <b className="story-who">{group.isMine ? STORY_COPY.yours : group.displayName}</b>
      <span className="story-age">{story.expiresAt === null ? STORY_COPY.sample : postAgeWords(story.createdAt, new Date())}</span>
      <button type="button" className="story-icon" onClick={props.onPause} aria-pressed={props.isPaused}>{props.isPaused ? STORY_COPY.play : STORY_COPY.pause}</button>
      <button ref={props.closeRef} type="button" className="story-icon" onClick={props.onClose} aria-label={STORY_COPY.close}>
        <Icon name="close" size={26} />
      </button>
    </header>
  );
};

// The viewer, over the whole page on a phone and as a tall card on a dark ground on a laptop: the bars, the head, the picture with
// Previous on its left third and Next on the rest, then the foot. A story moves on after STORY_SHOW_MS unless paused or the person
// prefers less motion, and the viewer closes after the last one.
const StoryViewer = (props: { groups: StoryGroup[]; startAt: number; onSeen: (storyId: string) => void; onClose: () => void; onDeleted: () => void }): ReactElement | null => {
  const { groups, onClose } = props;
  const [place, setPlace] = useState<ViewerPlace>({ group: props.startAt, story: 0 });
  const [isPaused, setIsPaused] = useState(prefersLessMotion);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const group = groups[place.group];
  const story = group?.stories[place.story];
  const next = (): void => {
    const after = nextPlace(groups, place);
    if (after === null) onClose();
    else setPlace(after);
  };
  const previous = (): void => { setPlace(previousPlace(place)); };
  const togglePause = (): void => { setIsPaused(!isPaused); };
  useViewerFocus(closeRef);
  useStoryClock(story?.storyId, isPaused, next);
  const seenId = story?.storyId;
  const markSeen = useRef(props.onSeen);
  useEffect(() => {
    if (seenId !== undefined) markSeen.current(seenId);
  }, [seenId]);
  if (group === undefined || story === undefined) return null;
  const name = group.isMine ? STORY_COPY.yours : group.displayName;
  return (
    <div className="story-viewer" role="dialog" aria-modal="true" aria-label={`${name}: story ${String(place.story + 1)} of ${String(group.stories.length)}`}
      onKeyDown={(event) => { onViewerKey(event, { next, previous, close: onClose, togglePause }); }}>
      <div className="story-card">
        <StoryBars key={story.storyId} group={group} at={place.story} isPaused={isPaused} />
        <ViewerHead group={group} story={story} isPaused={isPaused} onPause={togglePause} onClose={onClose} closeRef={closeRef} />
        <div className="story-stage">
          <StoryPicture src={photoUrl(story.photo)} alt={story.photoAlt ?? `${group.displayName}'s photo`} text={story.text} />
          <button type="button" className="story-tap is-previous" onClick={previous} aria-label={STORY_COPY.previous} />
          <button type="button" className="story-tap is-next" onClick={next} aria-label={STORY_COPY.next} />
        </div>
        <ViewerFoot group={group} storyId={story.storyId} onDeleted={() => { props.onDeleted(); onClose(); }} />
      </div>
    </div>
  );
};
