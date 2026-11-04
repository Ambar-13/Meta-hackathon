import type { ReactElement } from "react";
import { PolicyPage, PolicySections, type PolicySection } from "./policy-page.js";

// What Meety keeps, what it does with it, who sees what, what it keeps in the browser, and how to
// delete it, true to what the code does.
const PRIVACY_SECTIONS: readonly PolicySection[] = [
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
      "Meety shows no ads and sells nothing.",
      "Meety counts visits with Google Analytics: which kinds of page are opened, on what kind of device, and from roughly where. It sends the kind of page, such as a profile or a brief, never whose it is or what it says, and never your name.",
      "If your browser sends Global Privacy Control or Do Not Track, Meety sends nothing to Google Analytics.",
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
      "One cookie keeps you signed in for 90 days, and signing in with Google uses a second one for 10 minutes. Your browser also keeps three notes for the app, one of which counts visits. The Cookies page lists all five.",
    ],
  },
  {
    title: "Deleting it",
    lines: [
      "Settings, then Delete my account, removes everything that belongs to you. A record of what the AI calls cost stays, with nothing that points to you. You can delete a post or a story yourself at any time.",
    ],
  },
];

// /privacy, which Google's sign-in screen links to.
export const PrivacyScreen = (): ReactElement => {
  return (
    <PolicyPage title="Privacy" changed="5 November 2026">
      <PolicySections sections={PRIVACY_SECTIONS} />
    </PolicyPage>
  );
};
