import "./explore.css";
import { useState, type FormEvent, type ReactElement } from "react";
import { Link } from "react-router-dom";
import type { DirectoryListing } from "@meet-first/contracts";
import { APP_PATHS, ErrorNotice, ScreenFrame } from "../../app-shell/index.js";
import { EmptyState, LoadingLine, NameTag, Sticker, type TagColour } from "../../look/index.js";
import { SEARCH_MAX_CHARS, useDirectoryBrowse, type BrowseHook } from "../directory/index.js";

// The words of the Explore page (wave 7).
const EXPLORE_COPY = {
  title: "Explore",
  searchLabel: "Search Explore",
  search: "Search",
  stuck: "Stuck on something?",
  askOrchestrator: "Ask Meety who could help.",
  loading: "Loading people.",
  emptyTitle: "Nobody matches yet",
  emptyLine: "Try other words, or clear the search.",
  more: "Show more",
  retry: "Try again",
  peopleLabel: "People in Explore",
} as const;
// The words a listing open to dating questions shows, as the directory showed them (design section 11).
const OPEN_TO_ROMANCE_COPY = "Open to dating questions";

// The band colour of the tile at this place: green and lilac in turn, the colours of people outside a meeting (docs/DESIGN.md).
function tileColour(index: number): TagColour {
  return index % 2 === 0 ? "green" : "lilac";
}

// The search box: the words go to Explore from page 0, and an empty search lists everyone, newest first (design section 6).
const SearchForm = (props: { onSearch: (query: string) => void }): ReactElement => {
  const [text, setText] = useState("");
  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    props.onSearch(text);
  };
  return (
    <form role="search" className="explore-search" onSubmit={onSubmit}>
      <label>
        {EXPLORE_COPY.searchLabel}
        <input type="text" maxLength={SEARCH_MAX_CHARS} value={text} onChange={(event) => { setText(event.target.value); }} />
      </label>
      <button type="submit" className="quiet">
        <Sticker name="lens" />
        {EXPLORE_COPY.search}
      </button>
    </form>
  );
};

// One person as a tile: their name tag, their name, their line, their first public item's claim, and the dating words when open.
// The whole tile is one link to their profile.
const PersonTile = (props: { listing: DirectoryListing; index: number }): ReactElement => {
  const { listing } = props;
  const first = listing.items[0];
  return (
    <li>
      <Link className="explore-tile" to={APP_PATHS.person(listing.listingId)}>
        <NameTag name={listing.displayName} colour={tileColour(props.index)} className={props.index % 2 === 0 ? "tile-tag" : "tile-tag tilt-b"} />
        <h2 className="tile-name">{listing.displayName}</h2>
        <p className="tile-line">{listing.line}</p>
        {first === undefined ? null : <p className="tile-claim">{first.claim}</p>}
        {listing.openToRomance ? <p className="listing-open">{OPEN_TO_ROMANCE_COPY}</p> : null}
      </Link>
    </li>
  );
};

// The grid with its states: loading, an error with a retry, nobody found, and Show more while more pages exist.
const PeopleGrid = (props: { browse: BrowseHook }): ReactElement => {
  const { browse } = props;
  const isEmpty = browse.hasLoaded && !browse.isLoading && browse.error === null && browse.listings.length === 0;
  return (
    <section className="explore-people" aria-label={EXPLORE_COPY.peopleLabel}>
      {browse.error === null ? null : (
        <div className="explore-error">
          <ErrorNotice error={browse.error} />
          <button type="button" className="quiet" onClick={() => { browse.search(browse.query); }}>{EXPLORE_COPY.retry}</button>
        </div>
      )}
      {browse.isLoading && !browse.hasLoaded ? <LoadingLine text={EXPLORE_COPY.loading} /> : null}
      {isEmpty ? <EmptyState sticker="lens" title={EXPLORE_COPY.emptyTitle}>{EXPLORE_COPY.emptyLine}</EmptyState> : null}
      <ul className="explore-grid">
        {browse.listings.map((listing, index) => (
          <PersonTile key={listing.listingId} listing={listing} index={index} />
        ))}
      </ul>
      {browse.hasMore ? (
        <button type="button" className="quiet explore-more" disabled={browse.isLoading} onClick={browse.loadMore}>
          {EXPLORE_COPY.more}
        </button>
      ) : null}
    </section>
  );
};

// The /explore page: the search box, a way to ask the orchestrator for help, and everyone in Explore as a grid of tiles (wave 7).
export const ExploreScreen = (): ReactElement => {
  const browse = useDirectoryBrowse();
  return (
    <ScreenFrame title={EXPLORE_COPY.title} isWide>
      <SearchForm onSearch={browse.search} />
      <p className="explore-stuck">
        {`${EXPLORE_COPY.stuck} `}
        <Link to={APP_PATHS.home}>{EXPLORE_COPY.askOrchestrator}</Link>
      </p>
      <PeopleGrid browse={browse} />
    </ScreenFrame>
  );
};
