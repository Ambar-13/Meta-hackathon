import type { ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import { APP_PATHS } from "../../app-shell/index.js";
import { Cloud, NameTag, Sticker } from "../../look/index.js";
import { GoogleSignIn, WelcomeForm } from "./welcome-forms.js";
import { FirstCoffee, QuestionKinds, SampleMeeting, WhatItDoes } from "./welcome-story.js";
import { BackAgain, LastCall, Promises, ThreeSteps, WelcomeFooter } from "./welcome-close.js";
import "./welcome.css";

// The first screen: the sky, the headline with two name tags stuck beside its last word, what it does in one line, Continue with Google
// when the site offers it, and the name-tag form, so a phone shows the purpose and the main action before any scroll (design pass fix 1).
const WelcomeHero = (props: { onDone: () => void }): ReactElement => {
  return (
    <section className="wl-hero sky" aria-labelledby="wl-hero-title">
      <Cloud className="wl-cloud-a" />
      <Cloud className="wl-cloud-b" />
      <Cloud className="wl-cloud-c" />
      <nav className="wl-nav" aria-label="Main">
        <Link className="logo" to={APP_PATHS.welcome} aria-label="Meety start page">
          <Sticker name="tags" />
          Meety
        </Link>
        <span className="wl-nav-chips">
          <a className="chip c-green wl-desk" href="#how">How it works</a>
          <a className="chip c-lilac wl-desk" href="#kinds">Questions</a>
          <a className="chip c-coral" href="#code">I have a code</a>
        </span>
      </nav>
      <h1 className="wl-hl" id="wl-hero-title">
        <span className="wl-w">Your Meety</span> <br className="wl-br" />
        <span className="wl-w">meets</span> <span className="wl-w">theirs</span> <br className="wl-br" />
        <span className="wl-w wl-end">first.</span>
        <NameTag name="Mira" className="wl-hl-tag a" />
        <NameTag name="Jonah" colour="blue" className="wl-hl-tag b" />
      </h1>
      <p className="wl-lede">They play out how the two of you would probably get on. Then you get a short brief, and every line shows the words it came from.</p>
      <GoogleSignIn />
      <WelcomeForm onDone={props.onDone} />
      <div className="scallop" aria-hidden="true" />
    </section>
  );
};

// The start page: the landing with the name-tag form first, the story of how it works, and the way back in with a recovery code.
export const WelcomeScreen = (): ReactElement => {
  const navigate = useNavigate();
  const goToUpload = (): void => {
    navigate(APP_PATHS.upload, { replace: true });
  };
  return (
    <>
      <main className="wl">
        <WelcomeHero onDone={goToUpload} />
        <WhatItDoes />
        <SampleMeeting />
        <QuestionKinds />
        <FirstCoffee />
        <ThreeSteps />
        <Promises />
        <LastCall />
        <BackAgain onDone={goToUpload} />
      </main>
      <WelcomeFooter />
    </>
  );
};
