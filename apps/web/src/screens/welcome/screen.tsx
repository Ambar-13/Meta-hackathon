import type { ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import { APP_PATHS } from "../../app-shell/index.js";
import { PersonAvatar, Sticker } from "../../look/index.js";
import { GoogleSignIn, RecoverForm, WelcomeForm } from "./welcome-forms.js";
import "./welcome.css";

const PERSONS = [
  { name: "Jun", photo: "faces/jun", line: "Builds small robots and asks big questions." },
  { name: "Maya", photo: "faces/maya", line: "Invests in people before patterns." },
  { name: "Priya", photo: "faces/priya", line: "Designs products people can explain." },
] as const;

const PersonLine = (props: (typeof PERSONS)[number]): ReactElement => (
  <div className="wl-person-line">
    <PersonAvatar name={props.name} photo={props.photo} isSample size="m" />
    <span>
      <strong>{props.name}</strong>
      <small>{props.line}</small>
    </span>
    <span className="wl-sample">Sample person</span>
  </div>
);

const ProductDemo = (): ReactElement => (
  <div className="wl-demo-wrap" id="demo">
    <div className="wl-faces" aria-hidden="true">
      {PERSONS.map((person) => (
        <PersonAvatar key={person.name} name={person.name} photo={person.photo} isSample size="m" />
      ))}
    </div>
    <article className="wl-demo" aria-label="Fictional example conversation with Jun's Meety">
      <PersonLine {...PERSONS[0]} />
      <div className="wl-demo-thread">
        <p className="wl-question-bubble">Would Jun join an early hardware startup?</p>
        <div className="wl-answer">
          <div className="wl-answer-from">
            <Sticker name="tags" />
            <span>
              <strong>Jun&apos;s Meety</strong>
              <small>Answering from context Jun chose to share</small>
            </span>
          </div>
          <p>
            Probably, if he could own the hardware. He would chafe at a role that kept him away from
            the workbench.
          </p>
          <blockquote>
            “I want to build the machine, not just manage the people building it.”
            <cite>Jun, in a saved conversation</cite>
          </blockquote>
        </div>
      </div>
      <p className="wl-demo-note">Fictional example. Every answer keeps its source attached.</p>
    </article>
  </div>
);

const Hero = (): ReactElement => (
  <section className="wl-hero" aria-labelledby="wl-hero-title">
    <header className="wl-nav">
      <Link className="logo" to={APP_PATHS.welcome} aria-label="Meety start page">
        <Sticker name="tags" />
        Meety
      </Link>
      <nav aria-label="Main">
        <a className="wl-nav-link wl-nav-wide" href="#how">
          How it works
        </a>
        <a className="wl-nav-link" href="#signin">
          Sign in
        </a>
      </nav>
    </header>
    <div className="wl-hero-grid">
      <ProductDemo />
      <div className="wl-hero-copy">
        <p className="wl-eyebrow">People are more than profiles.</p>
        <h1 id="wl-hero-title">
          <span className="wl-hero-main">
            The <span className="wl-hero-next">next generation</span> of social media,
          </span>{" "}
          <span className="wl-hero-context">with context.</span>
        </h1>
        <p className="wl-lede">
          Ask what someone would care about, want, dislike, or debate before the real conversation
          begins. Their Meety answers only from context they chose to share.
        </p>
        <div className="wl-hero-actions">
          <a className="btn big" href="#start">
            Create your Meety
          </a>
          <a className="wl-text-link" href="#demo">
            See it in action
          </a>
        </div>
        <p className="wl-hero-note">No scores. No mind reading. Every answer shows its source.</p>
      </div>
    </div>
  </section>
);

const Possibilities = (): ReactElement => {
  const prompts = [
    ["Maya", "faces/maya", "What would Maya challenge in this idea?"],
    ["Priya", "faces/priya", "Would Priya want to design this with me?"],
    ["Jun", "faces/jun", "What would Jun refuse to compromise on?"],
    ["Ravi", "faces/ravi", "Where would Ravi disagree with my approach?"],
  ] as const;
  return (
    <section className="wl-try" id="try" aria-labelledby="wl-try-title">
      <div className="wl-section-head">
        <p>Not another empty profile</p>
        <h2 id="wl-try-title">Questions profiles cannot answer.</h2>
        <p>A profile shows what someone posted. These are questions their Meety could answer.</p>
      </div>
      <div className="wl-prompt-grid">
        {prompts.map(([name, photo, prompt]) => (
          <article className="wl-prompt" key={prompt}>
            <PersonAvatar name={name} photo={photo} isSample size="m" />
            <p>{prompt}</p>
            <span>Example for {name}&apos;s Meety</span>
          </article>
        ))}
      </div>
    </section>
  );
};

const HowItWorks = (): ReactElement => {
  const steps = [
    {
      number: "01",
      title: "Choose your context",
      text: "Bring conversations, notes, or answers. Approve every point before anyone can ask about it.",
    },
    {
      number: "02",
      title: "Let people ask",
      text: "Friends can ask what you might want, dislike, know, or argue about without pretending the answer is certain.",
    },
    {
      number: "03",
      title: "Start closer",
      text: "Take the useful context into the real conversation. Your Meety never replaces you.",
    },
  ] as const;
  return (
    <section className="wl-how" id="how" aria-labelledby="wl-how-title">
      <div className="wl-section-head">
        <p>How Meety works</p>
        <h2 id="wl-how-title">Your context becomes a better beginning.</h2>
      </div>
      <ol>
        {steps.map((step) => (
          <li key={step.number}>
            <span>{step.number}</span>
            <div>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
};

const Trust = (): ReactElement => (
  <section className="wl-trust" aria-labelledby="wl-trust-title">
    <div>
      <p>Built for people, not prediction</p>
      <h2 id="wl-trust-title">What people share stays theirs.</h2>
    </div>
    <ul>
      <li>
        <strong>You approve every point.</strong>
        Nothing becomes part of your Meety silently.
      </li>
      <li>
        <strong>Answers stay qualified.</strong>
        Meety says probably, never pretends to know what you will do.
      </li>
      <li>
        <strong>Sources remain visible.</strong>A claim without context is not presented as your
        view.
      </li>
      <li>
        <strong>Delete means delete.</strong>
        Remove your account and the context held with it goes too.
      </li>
    </ul>
  </section>
);

const Start = (props: { onDone: () => void }): ReactElement => (
  <section className="wl-start" id="start" aria-labelledby="wl-start-title">
    <div className="wl-start-copy">
      <p>Start with your name</p>
      <h2 id="wl-start-title">Build the version of you that can explain itself.</h2>
      <p>Set up takes a few minutes. You decide what is private, shared, or removed.</p>
    </div>
    <div className="wl-start-form">
      <GoogleSignIn />
      <WelcomeForm onDone={props.onDone} />
    </div>
  </section>
);

const Footer = (props: { onDone: () => void }): ReactElement => (
  <footer className="wl-footer">
    <section id="signin" aria-labelledby="wl-signin-title">
      <div>
        <h2 id="wl-signin-title">Already have a Meety?</h2>
        <p>Use the recovery code you saved when you joined.</p>
      </div>
      <RecoverForm onDone={props.onDone} />
    </section>
    <div className="wl-footer-row">
      <Link className="logo" to={APP_PATHS.welcome} aria-label="Meety start page">
        <Sticker name="tags" />
        Meety
      </Link>
      <nav aria-label="Footer">
        <a href="#signin">Sign in</a>
        <Link to={APP_PATHS.privacy}>Privacy</Link>
        <Link to={APP_PATHS.terms}>Terms</Link>
        <Link to={APP_PATHS.cookies}>Cookies</Link>
      </nav>
    </div>
  </footer>
);

// The public start page explains Meety through a product example, then offers setup and sign-in.
export const WelcomeScreen = (): ReactElement => {
  const navigate = useNavigate();
  const goToUpload = (): void => {
    navigate(APP_PATHS.upload, { replace: true });
  };
  return (
    <>
      <main className="wl">
        <Hero />
        <Possibilities />
        <HowItWorks />
        <Trust />
        <Start onDone={goToUpload} />
      </main>
      <Footer onDone={goToUpload} />
    </>
  );
};
