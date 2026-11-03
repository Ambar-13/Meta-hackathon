import type { ReactElement } from "react";
import { PolicyPage, PolicySections, type PolicySection } from "./policy-page.js";

// One thing Meety keeps in the browser: its name as the browser shows it, what it is for, and how long it stays.
type BrowserItem = { name: string; purpose: string; stays: string };

// The two cookies, both set by Meety's server and both needed to sign in (apps/api/src/sessions).
const COOKIES: readonly BrowserItem[] = [
  {
    name: "__Host-session",
    purpose: "Keeps you signed in. Only Meety's server can read it, and only over a secure connection.",
    stays: "Lasts 90 days. Deleting your account removes it.",
  },
  {
    name: "__Host-google",
    purpose: "Carries a one-time check while you sign in with Google, so Google's answer comes back only to the browser that asked for it.",
    stays: "Lasts 10 minutes, and goes as soon as you are back.",
  },
];

// The two notes the app keeps in the browser's own storage, which no request carries to the server.
const NOTES: readonly BrowserItem[] = [
  {
    name: "meet-first-stories-seen",
    purpose: "The stories you have watched, so their ring stops showing as new.",
    stays: "Stays until you clear this site's data. It never leaves your browser.",
  },
  {
    name: "meet-first.access-code",
    purpose: "The access code you joined with, so the invite links you share carry it and your friends need not type it.",
    stays: "Stays until you clear this site's data. It leaves your browser only inside the invite links you share.",
  },
];

// Google's own cookies, and how to remove all four.
const COOKIE_SECTIONS: readonly PolicySection[] = [
  {
    title: "Google's own page",
    lines: ["If you choose Continue with Google, Google's sign-in page may set cookies of its own on google.com. Google's privacy policy covers those."],
  },
  {
    title: "Removing them",
    lines: ["Deleting your account in Settings removes the sign-in cookie. Clearing this site's data in your browser removes all four."],
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

// /cookies: the two cookies and the two notes, why there is nothing to accept, and how to remove them.
export const CookiesScreen = (): ReactElement => {
  return (
    <PolicyPage title="Cookies" changed="3 November 2026">
      <p className="policy-lead">
        Meety keeps four small things in your browser: two cookies that sign you in, and two notes for the app. There are no ads, no
        trackers and no analytics, so there is nothing to accept or refuse.
      </p>
      <ItemList title="The two cookies" items={COOKIES} />
      <ItemList title="The two notes" items={NOTES} />
      <PolicySections sections={COOKIE_SECTIONS} />
    </PolicyPage>
  );
};
