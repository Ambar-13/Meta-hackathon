import type { ReactElement } from "react";
import { createBrowserRouter, Link, Navigate, type RouteObject } from "react-router-dom";
import { APP_PATHS, ROUTE_PATTERNS } from "./app-paths.js";
import { ScreenFrame } from "./screen-parts.js";
import { WelcomeScreen, ClaimScreen } from "../screens/welcome/index.js";
import { UploadScreen } from "../screens/upload/index.js";
import { PairScreen, JoinScreen } from "../screens/pair/index.js";
import { NamesReviewScreen } from "../screens/names-review/index.js";
import { CardScreen } from "../screens/card/index.js";
import { QuizScreen } from "../screens/quiz/index.js";
import { LobbyScreen } from "../screens/lobby/index.js";
import { MeetingScreen } from "../screens/meeting/index.js";
import { BriefScreen } from "../screens/brief/index.js";
import { ComicScreen } from "../screens/comic/index.js";
import { ConsentScreen, PublicSharePage } from "../screens/share/index.js";
import { SettingsScreen } from "../screens/settings/index.js";
import { HelpScreen } from "../screens/help/index.js";
import { FriendsScreen } from "../screens/friends/index.js";
import { AskScreen } from "../screens/ask/index.js";
import { ChatScreen } from "../screens/chat/index.js";
import { FeedScreen, SearchScreen } from "../screens/explore/index.js";
import { MeScreen } from "../screens/me/index.js";
import { PersonScreen } from "../screens/people/index.js";
import { CreateScreen } from "../screens/create/index.js";
import { CookiesScreen, PrivacyScreen, TermsScreen } from "../screens/policies/index.js";

// Every client path the app links to, re-exported for the screens that read the route table.
export { APP_PATHS } from "./app-paths.js";

// The page for a path the app does not know.
const NotFoundScreen = (): ReactElement => {
  return (
    <ScreenFrame title="No page here">
      <p>This address does not match a page.</p>
      <div className="actions">
        <Link className="btn" to={APP_PATHS.welcome}>
          Go to the start page
        </Link>
      </div>
    </ScreenFrame>
  );
};

// The route table: one route per ROUTE_PATTERNS entry, in that order, then the not-found route.
export const APP_ROUTES: RouteObject[] = [
  { path: ROUTE_PATTERNS.welcome, element: <WelcomeScreen /> },
  { path: ROUTE_PATTERNS.upload, element: <UploadScreen /> },
  { path: ROUTE_PATTERNS.pair, element: <PairScreen /> },
  { path: ROUTE_PATTERNS.join, element: <JoinScreen /> },
  { path: ROUTE_PATTERNS.claim, element: <ClaimScreen /> },
  { path: ROUTE_PATTERNS.settings, element: <SettingsScreen /> },
  { path: ROUTE_PATTERNS.namesReview, element: <NamesReviewScreen /> },
  { path: ROUTE_PATTERNS.card, element: <CardScreen /> },
  { path: ROUTE_PATTERNS.quiz, element: <QuizScreen /> },
  { path: ROUTE_PATTERNS.lobby, element: <LobbyScreen /> },
  { path: ROUTE_PATTERNS.meeting, element: <MeetingScreen /> },
  { path: ROUTE_PATTERNS.brief, element: <BriefScreen /> },
  { path: ROUTE_PATTERNS.comic, element: <ComicScreen /> },
  { path: ROUTE_PATTERNS.consent, element: <ConsentScreen /> },
  { path: ROUTE_PATTERNS.sharePage, element: <PublicSharePage /> },
  { path: ROUTE_PATTERNS.directory, element: <Navigate to={APP_PATHS.search} replace /> },
  { path: ROUTE_PATTERNS.help, element: <HelpScreen /> },
  { path: ROUTE_PATTERNS.friends, element: <FriendsScreen /> },
  { path: ROUTE_PATTERNS.ask, element: <AskScreen /> },
  { path: ROUTE_PATTERNS.home, element: <FeedScreen /> },
  { path: ROUTE_PATTERNS.explore, element: <Navigate to={APP_PATHS.search} replace /> },
  { path: ROUTE_PATTERNS.me, element: <MeScreen /> },
  { path: ROUTE_PATTERNS.person, element: <PersonScreen /> },
  { path: ROUTE_PATTERNS.meety, element: <ChatScreen /> },
  { path: ROUTE_PATTERNS.search, element: <SearchScreen /> },
  { path: ROUTE_PATTERNS.create, element: <CreateScreen /> },
  { path: ROUTE_PATTERNS.privacy, element: <PrivacyScreen /> },
  { path: ROUTE_PATTERNS.terms, element: <TermsScreen /> },
  { path: ROUTE_PATTERNS.cookies, element: <CookiesScreen /> },
  { path: "*", element: <NotFoundScreen /> },
];

// Builds the browser router for the running app.
export function createAppRouter(): ReturnType<typeof createBrowserRouter> {
  return createBrowserRouter(APP_ROUTES);
}
