import { briefsRoutes } from "./briefs.js";
import { cardsRoutes } from "./cards.js";
import { asksRoutes, directoryRoutes } from "./directory.js";
import { meetingsRoutes } from "./meetings.js";
import { peopleRoutes } from "./people.js";
import { sourcesRoutes } from "./sources.js";

// Route maps for each feature, so both apps read every path from one place.
export * from "./people.js";
export * from "./sources.js";
export * from "./cards.js";
export * from "./meetings.js";
export * from "./briefs.js";
export * from "./directory.js";
// Every route map under one name: routes.sources.createSource.path, routes.meetings.startMeeting.method, and so on.
export const routes = { people: peopleRoutes, sources: sourcesRoutes, cards: cardsRoutes, meetings: meetingsRoutes, briefs: briefsRoutes, directory: directoryRoutes, asks: asksRoutes } as const;
