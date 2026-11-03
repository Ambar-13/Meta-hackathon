import "./explore.css";
import { useState, type FormEvent, type ReactElement } from "react";
import { Link } from "react-router-dom";
import { chatPathWithDraft, ErrorNotice, ScreenFrame } from "../../app-shell/index.js";
import { EmptyState, Icon, LoadingLine, photoOf } from "../../look/index.js";
import { SEARCH_MAX_CHARS, useDirectoryBrowse, type BrowseHook } from "../directory/index.js";
import { useExploreFriends, useExplorePosts, type ExploreFriends } from "./explore-state.js";
import { PersonRow, PhotoGrid } from "./people-parts.js";

// The words of Search (3 Nov 2026). Ambar: "there is no search button to find poeple and send then friend requests like insta".
const SEARCH_COPY = {
  title: "Search",
  label: "Search people",
  placeholder: "Name or what they do",
  submit: "Search",
  stuck: "Can't find the right person?",
  askMeety: "Ask Meety who could help.",
  loading: "Loading people.",
  emptyTitle: "Nobody matches yet",
  emptyLine: "Try a name, or what someone does.",
  more: "Show more",
  retry: "Try again",
  suggestedTitle: "Suggested for you",
  seeEveryone: "See everyone",
  everyoneTitle: "Everyone",
  resultsTitle: "People",
  photosTitle: "Explore",
} as const;
// How many people Search suggests before See everyone.
const SUGGESTED_MAX = 6;

// The heading over the people: what a search found, everyone after See everyone, or the people Search suggests.
function peopleTitle(isSearching: boolean, isEveryone: boolean): string {
  if (isSearching) return SEARCH_COPY.resultsTitle;
  return isEveryone ? SEARCH_COPY.everyoneTitle : SEARCH_COPY.suggestedTitle;
}

// The search box, as Instagram's: the grey field with its magnifier and a Search button. The words go to Explore from page 0; an empty
// search goes back to the people Search suggests.
const SearchForm = (props: { onSearch: (query: string) => void }): ReactElement => {
  const [text, setText] = useState("");
  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    props.onSearch(text);
  };
  return (
    <form role="search" className="explore-search" onSubmit={onSubmit}>
      <label className="explore-field">
        <span className="hidden-words">{SEARCH_COPY.label}</span>
        <Icon name="search" size={18} className="explore-glass" />
        <input type="search" placeholder={SEARCH_COPY.placeholder} maxLength={SEARCH_MAX_CHARS} value={text} enterKeyHint="search"
          onChange={(event) => { setText(event.target.value); }} />
      </label>
      <button type="submit" className="quiet">{SEARCH_COPY.submit}</button>
    </form>
  );
};

// People as rows, each with Add friend, under a heading, with Show more while more pages exist; a cap shows only the first ones, with
// See everyone under them.
const PeopleRows = (props: { title: string; browse: BrowseHook; friends: ExploreFriends; cap: number | null; onSeeEveryone: () => void }): ReactElement => {
  const { browse, cap } = props;
  const shown = cap === null ? browse.listings : browse.listings.slice(0, cap);
  const hasHidden = cap !== null && browse.listings.length > cap;
  return (
    <section className="people-list" aria-labelledby="people-list-title">
      <div className="explore-head">
        <h2 id="people-list-title">{props.title}</h2>
      </div>
      <ul className="person-rows">
        {shown.map((listing) => <PersonRow key={listing.listingId} listing={listing} friends={props.friends} />)}
      </ul>
      {hasHidden ? <button type="button" className="quiet explore-more" onClick={props.onSeeEveryone}>{SEARCH_COPY.seeEveryone}</button> : null}
      {!hasHidden && browse.hasMore ? (
        <button type="button" className="quiet explore-more" disabled={browse.isLoading} onClick={browse.loadMore}>{SEARCH_COPY.more}</button>
      ) : null}
    </section>
  );
};

// The states above the people: an error with Try again, loading, and nobody found.
const SearchStatus = (props: { browse: BrowseHook }): ReactElement => {
  const { browse } = props;
  const isNobody = browse.hasLoaded && !browse.isLoading && browse.error === null && browse.listings.length === 0;
  return (
    <>
      {browse.error === null ? null : (
        <div className="explore-error">
          <ErrorNotice error={browse.error} />
          <button type="button" className="quiet" onClick={() => { browse.search(browse.query); }}>{SEARCH_COPY.retry}</button>
        </div>
      )}
      {browse.isLoading && !browse.hasLoaded ? <LoadingLine text={SEARCH_COPY.loading} /> : null}
      {isNobody ? <EmptyState sticker="lens" title={SEARCH_COPY.emptyTitle}>{SEARCH_COPY.emptyLine}</EmptyState> : null}
    </>
  );
};

// Search, as Instagram's search tab: the search box at the top, with a way to ask Meety who could help; then the people a search found,
// or with no search the people Search suggests (six, then See everyone), each with Add friend, and under them the photos of Explore as
// Instagram's grid.
export const SearchScreen = (): ReactElement => {
  const browse = useDirectoryBrowse();
  const friends = useExploreFriends();
  const posts = useExplorePosts();
  const [isEveryone, setIsEveryone] = useState(false);
  const isSearching = browse.query !== "";
  const search = (query: string): void => {
    setIsEveryone(false);
    browse.search(query);
  };
  const title = peopleTitle(isSearching, isEveryone);
  const hasPhotos = (posts.value?.posts ?? []).some((post) => post.isMine !== true && photoOf(post.photo) !== null);
  return (
    <ScreenFrame title={SEARCH_COPY.title} hasOwnHeading isWide>
      <div className="search-page">
        <h1 className="search-title">{SEARCH_COPY.title}</h1>
        <SearchForm onSearch={search} />
        <p className="explore-stuck">
          {`${SEARCH_COPY.stuck} `}
          <Link to={chatPathWithDraft("Who could help me with ")}>{SEARCH_COPY.askMeety}</Link>
        </p>
        <SearchStatus browse={browse} />
        {browse.listings.length === 0 ? null : (
          <PeopleRows title={title} browse={browse} friends={friends} cap={isSearching || isEveryone ? null : SUGGESTED_MAX} onSeeEveryone={() => { setIsEveryone(true); }} />
        )}
        {isSearching || !hasPhotos ? null : (
          <section className="search-photos" aria-labelledby="search-photos-title">
            <h2 id="search-photos-title">{SEARCH_COPY.photosTitle}</h2>
            <PhotoGrid posts={posts.value?.posts ?? []} />
          </section>
        )}
      </div>
    </ScreenFrame>
  );
};
