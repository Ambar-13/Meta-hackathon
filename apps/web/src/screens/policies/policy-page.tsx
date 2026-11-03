import type { ReactElement, ReactNode } from "react";
import { Link } from "react-router-dom";
import { APP_PATHS, ScreenFrame } from "../../app-shell/index.js";

// One part of a policy page: its heading and its paragraphs.
export type PolicySection = { title: string; lines: readonly string[] };

// Who to write to about anything on these pages.
const CONTACT_EMAIL = "hey.meety@gmail.com";

// The three policy pages; each one links to the other two at its foot.
const POLICY_LINKS: ReadonlyArray<{ title: string; to: string }> = [
  { title: "Privacy", to: APP_PATHS.privacy },
  { title: "Terms", to: APP_PATHS.terms },
  { title: "Cookies", to: APP_PATHS.cookies },
];

// Sections in order, each a heading and its paragraphs above a hairline.
export const PolicySections = (props: { sections: readonly PolicySection[] }): ReactElement => {
  return (
    <>
      {props.sections.map((section) => (
        <section key={section.title} className="policy-section">
          <h2>{section.title}</h2>
          {section.lines.map((line) => <p key={line}>{line}</p>)}
        </section>
      ))}
    </>
  );
};

// A policy page, which opens without a session: its title, the day it last changed, the page's own parts, then who to write to and
// the links to the other two pages and back to the start page.
export const PolicyPage = (props: { title: string; changed: string; children: ReactNode }): ReactElement => {
  return (
    <ScreenFrame title={props.title}>
      <p className="policy-date">{`Last changed ${props.changed}.`}</p>
      {props.children}
      <section className="policy-section">
        <h2>Questions</h2>
        <p>
          {"Write to "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </section>
      <nav className="policy-links" aria-label="Meety's policies">
        {POLICY_LINKS.filter((link) => link.title !== props.title).map((link) => (
          <Link key={link.to} to={link.to}>{link.title}</Link>
        ))}
        <Link to={APP_PATHS.welcome}>Back to Meety</Link>
      </nav>
    </ScreenFrame>
  );
};
