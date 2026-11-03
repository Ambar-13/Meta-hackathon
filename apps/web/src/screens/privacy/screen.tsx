import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { APP_PATHS, ScreenFrame } from "../../app-shell/index.js";

// The privacy page (3 Nov 2026), which Google's sign-in screen links to: what Meety keeps, what it does with it, who sees what, how to
// delete it, and who to write to, in plain words and true to what the code does.
const PRIVACY_SECTIONS: ReadonlyArray<{ title: string; lines: readonly string[] }> = [
  {
    title: "What Meety keeps",
    lines: [
      "Your display name. If you sign in with Google, Google's id for your account and your name. Never your email.",
      "The chats you upload, after your browser takes out your own messages and removes names, emails and phone numbers it recognises, and the server checks them again.",
      "Your card, built from those messages, which you approve item by item; your meetings and briefs; the friends you add.",
      "Your posts, stories, photos and likes. Photos are redrawn in your browser before they are sent, which leaves out where and with what camera they were taken.",
    ],
  },
  {
    title: "What Meety does with it",
    lines: [
      "Your Meety uses what you approved to answer your friends' questions and to talk with other people's Meetys. To do that, your words go to Meta's AI models through the Meta Model API.",
      "Meety shows no ads, uses no trackers, and sells nothing.",
    ],
  },
  {
    title: "Who sees what",
    lines: [
      "Once you join Explore, people signed in to Meety see your name, your line, the card items you made public, and your posts. Your stories show for 24 hours.",
      "Your friends' Meetys answer only from what you chose to share. Nobody sees a count of your likes or what you liked.",
    ],
  },
  {
    title: "Cookies and your browser",
    lines: [
      "One cookie keeps you signed in for 90 days. Signing in with Google uses a second one for 10 minutes. Your browser also remembers which stories you watched; that never leaves it.",
    ],
  },
  {
    title: "Deleting it",
    lines: [
      "Settings, then Delete my account, removes everything that belongs to you. A record of what the AI calls cost stays, with nothing that points to you. You can delete a post or a story yourself at any time.",
    ],
  },
];

// Who to write to about privacy.
const CONTACT_EMAIL = "hey.meety@gmail.com";

// /privacy: the sections above, then who to write to and the way back to the start page.
export const PrivacyScreen = (): ReactElement => {
  return (
    <ScreenFrame title="Privacy">
      <p className="privacy-date">Last changed 3 November 2026.</p>
      {PRIVACY_SECTIONS.map((section) => (
        <section key={section.title} className="privacy-section">
          <h2>{section.title}</h2>
          {section.lines.map((line) => <p key={line}>{line}</p>)}
        </section>
      ))}
      <section className="privacy-section">
        <h2>Questions</h2>
        <p>
          {"Write to "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </section>
      <p>
        <Link to={APP_PATHS.welcome}>Back to Meety</Link>
      </p>
    </ScreenFrame>
  );
};
