import type { ReactElement } from "react";
import { Link } from "react-router-dom";
import { APP_PATHS } from "../../app-shell/index.js";
import { Cloud, NameTag, Sticker, type StickerName } from "../../look/index.js";
import { RecoverForm } from "./welcome-forms.js";

// The end of the welcome page: the three steps, the promises, the last call, the way back in with a code, and the footer.

// One step of the first run: its colour, sticker, words and the time it takes.
type Step = { colour: string; sticker: StickerName; title: string; text: string; time: string };
// The three steps from the README, in order.
const STEPS: readonly Step[] = [
  { colour: "c-green", sticker: "phone", title: "Upload your chats", text: "From ChatGPT, Claude, Codex, your notes or a paste. Your browser keeps only your own messages and scrubs them before anything is sent.", time: "a couple of minutes" },
  { colour: "c-yellow", sticker: "check", title: "Approve your card", text: "Your Meety lists what it learned about you, each line with the quote it came from. You approve them one by one.", time: "you say yes to every line" },
  { colour: "c-coral", sticker: "tags", title: "Meet someone", text: "Share a code, pick a question, and the two Meetys talk it through. Nobody needs to be online. Watch it live or replay it later.", time: "a ten-minute talk" },
];

// The three steps as colour cards, each with its sticker breaking out of the top.
export const ThreeSteps = (): ReactElement => {
  return (
    <section className="wl-steps" id="steps" aria-labelledby="wl-steps-title">
      <h2 className="wl-title" id="wl-steps-title">Three steps to your first brief.</h2>
      <ol className="wl-step-list">
        {STEPS.map((step, index) => (
          <li key={step.title} className={`wl-step ${step.colour}`}>
            <Sticker name={step.sticker} />
            <span className="wl-step-num">{`0${String(index + 1)}`}</span>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
            <span className="wl-step-time">{step.time}</span>
          </li>
        ))}
      </ol>
    </section>
  );
};

// One promise: a sticker, a short heading and one line.
type PromiseCard = { sticker: StickerName; title: string; text: string };
// The four promises, each true of the build: probable reactions, no scores, scrubbing in the browser, deletion.
const PROMISES: readonly PromiseCard[] = [
  { sticker: "spark", title: "It says probably.", text: "Your Meety says how you would probably react. Never what you will do." },
  { sticker: "nope", title: "It never scores anyone.", text: "No ranking, no percent, no match number. Not about you, not about them." },
  { sticker: "soap", title: "Scrubbed in your browser.", text: "Your messages are cleaned on your own device before anything is sent." },
  { sticker: "poof", title: "Gone when you say so.", text: "Delete your account and everything we hold about you goes with it." },
];

// The promises on a blue band with cloud edges.
export const Promises = (): ReactElement => {
  return (
    <section className="wl-promise" aria-labelledby="wl-promise-title">
      <div className="scallop top" aria-hidden="true" />
      <h2 className="wl-title" id="wl-promise-title">No scores. Just your own words.</h2>
      <div className="wl-promise-cards">
        {PROMISES.map((promise) => (
          <article key={promise.title} className="wl-pcard">
            <Sticker name={promise.sticker} />
            <h3>{promise.title}</h3>
            <p>{promise.text}</p>
          </article>
        ))}
      </div>
      <div className="scallop" aria-hidden="true" />
    </section>
  );
};

// Moves the reader back to the name tag at the top and puts the cursor in it.
function focusNameTag(): void {
  const input = document.getElementById("display-name");
  input?.scrollIntoView({ behavior: "smooth", block: "center" });
  input?.focus({ preventScroll: true });
}

// The last call: a sky with clouds, two name tags, and one white cloud with the action in it.
export const LastCall = (): ReactElement => {
  return (
    <section className="wl-last sky" aria-labelledby="wl-last-title">
      <Cloud className="wl-last-cloud-a" />
      <Cloud className="wl-last-cloud-b" />
      <NameTag name="you" className="wl-last-tag a" />
      <NameTag name="them" colour="blue" className="wl-last-tag b" />
      <div className="wl-cloudcard">
        <svg viewBox="0 0 520 260" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path className="f-paper" d="M70 250C20 250 4 210 22 180 0 150 14 108 56 104 56 58 104 34 146 50 168 12 230 4 266 34 300 2 372 8 390 54 440 40 494 74 488 118 524 136 522 196 486 214 486 246 440 254 410 250z" />
        </svg>
        <h2 id="wl-last-title">Say hello first.</h2>
        <button type="button" className="big" onClick={focusNameTag}>
          Make my name tag
        </button>
      </div>
    </section>
  );
};

// The way back in: the recovery code form and the link for a browser that is already set up.
export const BackAgain = (props: { onDone: () => void }): ReactElement => {
  return (
    <section className="wl-back" id="code" aria-labelledby="wl-back-title">
      <div className="sticky-note wl-back-note">
        <h2 id="wl-back-title">Back again?</h2>
        <RecoverForm onDone={props.onDone} />
        <p>
          Already set up on this browser? <Link to={APP_PATHS.home}>Open your home</Link>
        </p>
      </div>
    </section>
  );
};

// The footer on navy: the name, the line, the puffy links and the age line.
export const WelcomeFooter = (): ReactElement => {
  return (
    <footer className="wl-foot">
      <p className="wl-foot-name">Meety</p>
      <p>Your Meety meets theirs first. With receipts.</p>
      <nav className="wl-puffs" aria-label="On this page">
        <a className="wl-puff c-yellow" href="#how">How it works</a>
        <a className="wl-puff c-green" href="#kinds">Questions</a>
        <a className="wl-puff c-coral" href="#code">I have a code</a>
      </nav>
      <p className="wl-foot-small">Probably, never will. No scores, ever.</p>
    </footer>
  );
};
