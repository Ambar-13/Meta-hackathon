import type { ReactElement } from "react";
import { PolicyPage, PolicySections, type PolicySection } from "./policy-page.js";

// The terms of using Meety: what it is and is not, the account, what people may upload and post, what is not allowed, what happens
// when the rules are broken, what the service promises, and how to leave.
const TERMS_SECTIONS: readonly PolicySection[] = [
  {
    title: "What Meety is",
    lines: [
      "Meety is a free app. It builds an AI agent of you from chats you choose to upload, using only the items you approve. Your agent talks with other people's agents and answers your friends' questions, to show how you would probably get on.",
      "Its answers are guesses made by an AI. They can be wrong, and a matching quote shows only where words came from, not that they are true. Use your own judgement before you meet someone or decide anything that matters.",
    ],
  },
  {
    title: "Your account",
    lines: [
      "You can join with a name and an access code, or with Google. One account is for one real person; do not join as someone else.",
      "If you joined with a name, keep your recovery code. Without it and without this browser, the account cannot be opened again.",
    ],
  },
  {
    title: "What you upload and post",
    lines: [
      "Upload only chats you wrote yourself, and post only photos and words you have the right to share.",
      "What you upload and post stays yours. You let Meety keep it, show it where you chose, and send it to Meta's AI models to run your agent, until you delete it.",
    ],
  },
  {
    title: "What is not allowed",
    lines: [
      "Harassing, threatening or pretending to be anyone.",
      "Sharing someone else's private messages, photos or details without their permission.",
      "Sexual content, hate, or anything against the law.",
      "Trying to read other people's data, getting around the access code or the limits, overloading the site, or copying it with scripts.",
    ],
  },
  {
    title: "When the rules are broken",
    lines: [
      "Meety may take down a post or a story, or close an account, that breaks these terms. To report something, write to the address below.",
    ],
  },
  {
    title: "What Meety promises",
    lines: [
      "Meety runs on a small daily budget for the AI. When the day's budget is spent, the AI parts of Meety pause until the next day.",
      "It may change, pause or stop, and what is stored in it may be lost. It comes as it is, with no promise that it will always work. As far as the law allows, Meety is not liable for any loss that comes from using it.",
    ],
  },
  {
    title: "Leaving",
    lines: [
      "You can delete your account at any time in Settings. That removes everything that belongs to you.",
    ],
  },
  {
    title: "Changes to these terms",
    lines: [
      "When these terms change, the date at the top changes too. Using Meety after that means you accept the new terms.",
    ],
  },
];

// /terms, which Google's sign-in screen and the welcome page's footer link to.
export const TermsScreen = (): ReactElement => {
  return (
    <PolicyPage title="Terms" changed="3 November 2026">
      <PolicySections sections={TERMS_SECTIONS} />
    </PolicyPage>
  );
};
