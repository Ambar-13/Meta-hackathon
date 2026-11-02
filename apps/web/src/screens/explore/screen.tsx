import "./explore.css";
import { useState, type FormEvent, type ReactElement } from "react";
import { Link } from "react-router-dom";
import type { DirectoryListing } from "@meet-first/contracts";
import { APP_PATHS, ErrorNotice, ScreenFrame } from "../../app-shell/index.js";
import { EmptyState, Icon, LoadingLine, PersonAvatar, tintOf } from "../../look/index.js";
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

// The search box: the words go to Explore from page 0, and an empty search lists everyone, newest first (design section 6).
const SearchForm = (props: { onSearch: (query: string) => void }): ReactElement => {
  const [text, setText] = useState("");
  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    props.onSearch(text);
  };
  return (
    <form role="search" className="explore-search" onSubmit={onSubmit}>
      <label className="explore-field">
        <span className="explore-label">{EXPLORE_COPY.searchLabel}</span>
        <Icon name="search" size={18} className="explore-glass" />
        <input type="text" placeholder="Search people by what they do" maxLength={SEARCH_MAX_CHARS} value={text} onChange={(event) => { setText(event.target.value); }} />
      </label>
      <button type="submit" className="quiet">{EXPLORE_COPY.search}</button>
    </form>
  );
};

// One person as a tile, like a post in Instagram's Explore: their line on their own colour, then their picture and name, their first
// public item's claim, and the dating words when open. The whole tile is one link to their profile.
const PersonTile = (props: { listing: DirectoryListing }): ReactElement => {
  const { listing } = props;
  const first = listing.items[0];
  return (
    <li>
      <Link className={`explore-tile ${tintOf(listing.displayName)}`} to={APP_PATHS.person(listing.listingId)}>
        <p className="tile-line">{listing.line}</p>
        <span className="tile-foot">
          <span className="tile-who">
            <PersonAvatar name={listing.displayName} size="s" />
            <h2 className="tile-name">{listing.displayName}</h2>
          </span>
          {first === undefined ? null : <span className="tile-claim">{first.claim}</span>}
          {listing.openToRomance ? <span className="listing-open">{OPEN_TO_ROMANCE_COPY}</span> : null}
        </span>
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
        {browse.listings.map((listing) => (
          <PersonTile key={listing.listingId} listing={listing} />
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
