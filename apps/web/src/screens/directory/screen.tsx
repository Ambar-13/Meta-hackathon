import { useState, type FormEvent, type ReactElement } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ErrorNotice, readApprovedCard, ScreenFrame } from "../../app-shell/index.js";
import { cardForMeeting, SEARCH_MAX_CHARS, useDirectoryBrowse, useListingMeeting, useYourListing, type BrowseHook, type MeetControls } from "./directory-state.js";
import { ListingCard, YourListingSection } from "./listing-parts.js";

// The words of the directory page that no input gives [confirm] (drafted copy).
const DIRECTORY_COPY = {
  searchLabel: "Search the directory",
  search: "Search",
  listingsHeading: "People in the directory",
  noCard: "To meet someone here, open your approved card and tap Open the directory.",
  emptyDirectory: "Nobody is listed yet.",
  noMatch: "No listing matches these words.",
} as const;

// The search box: the words go to the directory from page 0, and an empty search lists everyone, newest first (design section 6).
const SearchForm = (props: { onSearch: (query: string) => void }): ReactElement => {
  const [text, setText] = useState("");
  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    props.onSearch(text);
  };
  return (
    <form role="search" onSubmit={onSubmit}>
      <label>
        {DIRECTORY_COPY.searchLabel}
        <input type="text" maxLength={SEARCH_MAX_CHARS} value={text} onChange={(event) => { setText(event.target.value); }} />
      </label>
      <button type="submit">{DIRECTORY_COPY.search}</button>
    </form>
  );
};

// The line for a finished load that found nobody: one for the whole directory, one for search words.
const EmptyLine = (props: { browse: BrowseHook }): ReactElement | null => {
  const { browse } = props;
  if (!browse.hasLoaded || browse.isLoading || browse.listings.length > 0) return null;
  return <p>{browse.query === "" ? DIRECTORY_COPY.emptyDirectory : DIRECTORY_COPY.noMatch}</p>;
};

// The listings with the no-card notice, the error, the empty line, and More while more pages exist (design section 7).
const ListingsSection = (props: { browse: BrowseHook; meet: MeetControls | null }): ReactElement => {
  const { browse, meet } = props;
  return (
    <section aria-labelledby="listings-title">
      <h2 id="listings-title">{DIRECTORY_COPY.listingsHeading}</h2>
      {meet === null ? <p className="notice">{DIRECTORY_COPY.noCard}</p> : null}
      {browse.error === null ? null : <ErrorNotice error={browse.error} />}
      <EmptyLine browse={browse} />
      <ul>
        {browse.listings.map((listing) => (
          <ListingCard key={listing.listingId} listing={listing} meet={meet} />
        ))}
      </ul>
      {browse.hasMore ? (
        <button type="button" disabled={browse.isLoading} onClick={browse.loadMore}>
          More
        </button>
      ) : null}
    </section>
  );
};

// The /directory page: search the open directory, meet a listed persona with your approved card, and see your own listing (design section 7).
export const DirectoryScreen = (): ReactElement => {
  const navigate = useNavigate();
  const location = useLocation();
  const browse = useDirectoryBrowse();
  const yours = useYourListing();
  const listedCardId = yours.load.kind === "ready" ? yours.load.listedCardId : null;
  const cardId = cardForMeeting({ search: location.search, approvedCardId: readApprovedCard(), listedCardId });
  const meet = useListingMeeting({ cardId, go: (path) => { navigate(path); } });
  return (
    <ScreenFrame title="Directory">
      <SearchForm onSearch={browse.search} />
      <ListingsSection browse={browse} meet={cardId === null ? null : meet} />
      <YourListingSection yours={yours} />
    </ScreenFrame>
  );
};
