import type { ReactElement } from "react";
import { VISITOR_KEY } from "../../app-shell/index.js";
import { PolicyPage, PolicySections, type PolicySection } from "./policy-page.js";

// One thing Meety keeps in the browser: its name as the browser shows it, what it is for, and how
// long it stays.
type BrowserItem = { name: string; purpose: string; stays: string };

// The two cookies, both set by Meety's server and both needed to sign in (apps/api/src/sessions).
const COOKIES: readonly BrowserItem[] = [
  {
    name: "__Host-session",
    purpose:
      "Keeps you signed in. Only Meety's server can read it, and only over a secure connection.",
    stays: "Lasts 90 days. Deleting your account removes it.",
  },
  {
    name: "__Host-google",
    purpose:
      "Carries a one-time check while you sign in with Google, so Google's answer comes back only to the browser that asked for it.",
    stays: "Lasts 10 minutes, and goes as soon as you are back.",
  },
];

// The three notes the app keeps in the browser's own storage, which no request carries to Meety's
// server.
const NOTES: readonly BrowserItem[] = [
  {
    name: "meet-first-stories-seen",
    purpose: "The stories you have watched, so their ring stops showing as new.",
    stays: "Stays until you clear this site's data. It never leaves your browser.",
  },
  {
    name: "meet-first.access-code",
    purpose:
      "The access code you joined with, so the invite links you share carry it and your friends need not type it.",
    stays:
      "Stays until you clear this site's data. It leaves your browser only inside the invite links you share.",
  },
  {
    name: VISITOR_KEY,
    purpose:
      "A random number and a count of your visits, so Google Analytics can tell a second visit from a new visitor. It carries no name and nothing you wrote.",
    stays:
      "Stays until you clear this site's data. The number and the counts go to Google with each page you open.",
  },
];

// Google's own cookies, and how to remove all five.
const COOKIE_SECTIONS: readonly PolicySection[] = [
  {
    title: "Google's own page",
    lines: [
      "If you choose Continue with Google, Google's sign-in page may set cookies of its own on google.com. Google's privacy policy covers those.",
    ],
  },
  {
    title: "Removing them",
    lines: [
      "Deleting your account in Settings removes the sign-in cookie. Clearing this site's data in your browser removes all five.",
    ],
  },
];

// One group of browser items under its heading: each name, what it is for, and how long it stays.
const ItemList = (props: { title: string; items: readonly BrowserItem[] }): ReactElement => {
  return (
    <section className="policy-section">
      <h2>{props.title}</h2>
      <dl className="policy-list">
        {props.items.map((item) => (
          <div key={item.name}>
            <dt>{item.name}</dt>
            <dd>{item.purpose}</dd>
            <dd className="policy-stays">{item.stays}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
};

// /cookies: the two cookies and the three notes, how to keep analytics off, and how to remove them
// all.
export const CookiesScreen = (): ReactElement => {
  return (
    <PolicyPage title="Cookies" changed="5 November 2026">
      <p className="policy-lead">
        Meety keeps five small things in your browser: two cookies that sign you in, and three notes
        for the app, one of which counts visits with Google Analytics. There are no ads, and no
        other company sets a cookie here. If your browser sends Global Privacy Control or Do Not
        Track, Meety keeps no such note and sends nothing to Google.
      </p>
      <ItemList title="The two cookies" items={COOKIES} />
      <ItemList title="The three notes" items={NOTES} />
      <PolicySections sections={COOKIE_SECTIONS} />
    </PolicyPage>
  );
};
