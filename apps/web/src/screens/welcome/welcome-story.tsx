import type { ReactElement } from "react";
import { BRIEF_SECTION_LABELS, type QuestionKind } from "@meet-first/contracts";
import { Avatar, NameTag, Receipt, ReceiptFlag, Sticker, TypingDots, type StickerName } from "../../look/index.js";

// The welcome page below the first screen: what it does, a sample meeting, the kinds of question, the three steps, the
// promises and the last call. Mira and Jonah are made up, and the page says so; nothing here is a real person's data.

// The paragraph that says what Meety does, with small stickers inside the sentence (Lofty Lab's "who we are").
export const WhatItDoes = (): ReactElement => {
  return (
    <section className="wl-mission" id="how" aria-labelledby="wl-mission-title">
      <h2 className="wl-kicker" id="wl-mission-title">What it does</h2>
      <p className="wl-mission-text">
        Upload your chats once <Sticker name="chat" />. Your Meety learns how you talk, then meets someone else&apos;s Meety{" "}
        <Sticker name="tags" /> and plays it out: on a team <Sticker name="laptop" />, as friends <Sticker name="smile" />, on a
        first date <Sticker name="cup" />. You read a short brief, and every line shows its quote <Sticker name="quote" />.
      </p>
      <a className="btn quiet" href="#steps">
        See the three steps
      </a>
    </section>
  );
};

// One line of the sample meeting: who says it, what they say, and its quote or its missing-quote flag.
type SampleLine = { side: "a" | "b"; text: string; quote?: { text: string; source: string } };
// The sample meeting, word for word: a get-along question between two made-up people.
const SAMPLE_LINES: readonly SampleLine[] = [
  { side: "a", text: "Mira would probably want a plan before the first commit. She hates guessing what done looks like.", quote: { text: "I can't start until I know what done looks like.", source: "Mira, in a ChatGPT chat, 12 March" } },
  { side: "b", text: "Jonah would probably start building before the plan is done. He thinks out loud in code.", quote: { text: "Easier to show you than to explain it.", source: "Jonah, in his notes, 3 May" } },
  { side: "a", text: "Then she'd hand him the pitch. She'd rather do anything else.", quote: { text: "Please don't make me present.", source: "Mira, in a Claude chat, 2 April" } },
  { side: "b", text: "He'd take it, probably happily." },
];
// The two made-up people of the sample, by side.
const SAMPLE_NAMES = { a: "Mira", b: "Jonah" } as const;

// One sample bubble with its avatar and its quote or flag.
const SampleBubble = (props: { line: SampleLine }): ReactElement => {
  const { line } = props;
  const name = SAMPLE_NAMES[line.side];
  return (
    <div className={`msg ${line.side}`}>
      <Avatar name={name} side={line.side} />
      <div className={line.quote === undefined ? "bubble guess" : "bubble"}>
        <span className="who">{`${name}'s Meety`}</span>
        {line.text}
      </div>
      <div className="extra">{line.quote === undefined ? <ReceiptFlag isWeak={false} /> : <Receipt quote={line.quote.text} source={line.quote.source} />}</div>
    </div>
  );
};

// The sample meeting on a pale sky band: the question, the four lines, the typing dots, then the brief it ends in.
export const SampleMeeting = (): ReactElement => {
  return (
    <section className="wl-meet" aria-labelledby="wl-meet-title">
      <div className="scallop top" aria-hidden="true" />
      <div className="wl-meet-head">
        <h2 id="wl-meet-title">Watch two Meetys meet.</h2>
        <p>A sample. Mira and Jonah are made up; how it works is real.</p>
        <p className="wl-question">
          <Sticker name="spark" />
          Would we enjoy a 10-day hackathon together?
        </p>
      </div>
      <div className="wl-convo">
        <div className="talk">
          {SAMPLE_LINES.map((line) => (
            <SampleBubble key={line.text} line={line} />
          ))}
          <div className="msg a">
            <Avatar name="Mira" side="a" />
            <span className="bubble">
              <TypingDots label="Mira's Meety is writing" />
            </span>
          </div>
        </div>
        <SampleBrief />
      </div>
      <div className="scallop" aria-hidden="true" />
    </section>
  );
};

// The brief the sample meeting ends in, in its three get-along parts.
const SampleBrief = (): ReactElement => {
  const labels = BRIEF_SECTION_LABELS.get_along;
  return (
    <div className="wl-minibrief">
      <Sticker name="check" />
      <h3>Then the brief.</h3>
      <ol className="rows">
        <li><b>01</b><span><strong>{labels.agree}</strong>Mira plans, Jonah builds, and neither wants the other&apos;s job.</span></li>
        <li><b>02</b><span><strong>{labels.clash}</strong>He ships at 3 am. She is done by 9 pm.</span></li>
        <li><b>03</b><span><strong>{labels.decideFirst}</strong>Who owns the demo, and when the build stops.</span></li>
      </ol>
    </div>
  );
};

// One kind of question: its colour, its sticker, a curated question, and one probable line from each agent.
type KindPanel = { kind: QuestionKind; label: string; colour: string; sticker: StickerName; question: string; lines: readonly [string, string]; note?: string };
// The five kinds the page shows, each with a curated question from the lobby and the brief labels of its kind.
const KIND_PANELS: readonly KindPanel[] = [
  { kind: "get_along", label: "Getting along", colour: "c-green", sticker: "smile", question: "Would we enjoy a 10-day hackathon together?", lines: ["Mira would probably plan day one down to the hour.", "Jonah would probably plan the first hour, then wing it."] },
  { kind: "help", label: "Help", colour: "c-yellow", sticker: "buoy", question: "Where could each of us help the other most?", lines: ["Mira could probably untangle his database by Thursday.", "Jonah could probably make her demo look like a product."] },
  { kind: "deal", label: "A deal", colour: "c-coral", sticker: "coins", question: "If I build and you sell, would we close that deal tomorrow?", lines: ["Mira would probably ask for the bigger share for building it.", "Jonah would probably push for an even split, then meet her halfway."] },
  { kind: "debate", label: "A debate", colour: "c-lilac", sticker: "chat", question: "Will AI replace most junior engineers? Where do our views split?", lines: ["Mira would probably say it changes the job, not the hiring.", "Jonah would probably say fewer juniors get hired at first."] },
  { kind: "romance", label: "A first date", colour: "c-blue", sticker: "cup", question: "Would we enjoy a first date, and what would we talk about?", lines: ["Mira would probably pick the place with the good playlist.", "Jonah would probably bring up the trip he never took."], note: "Only when both of you switch it on." },
];

// One tilted colour panel: the kind, the question, the brief's three parts for that kind, and a two-line sample.
const KindCard = (props: { panel: KindPanel; index: number }): ReactElement => {
  const { panel } = props;
  const labels = BRIEF_SECTION_LABELS[panel.kind];
  return (
    <article className={`wl-kind ${panel.colour} wl-tilt-${String(props.index % 4)}`}>
      <div className="wl-kind-text">
        <span className="pill"><span className="dot" />{panel.label}</span>
        <h3>{panel.question}</h3>
        <ol className="rows">
          <li><b>01</b><span>{labels.agree}</span></li>
          <li><b>02</b><span>{labels.clash}</span></li>
          <li><b>03</b><span>{labels.decideFirst}</span></li>
        </ol>
        {panel.note === undefined ? null : <p className="wl-kind-note">{panel.note}</p>}
      </div>
      <div className="wl-kind-sample" aria-label="Two sample lines">
        <Sticker name={panel.sticker} />
        <p className="wl-mini a"><Avatar name="Mira" side="a" isSmall />{panel.lines[0]}</p>
        <p className="wl-mini b"><Avatar name="Jonah" side="b" isSmall />{panel.lines[1]}</p>
      </div>
    </article>
  );
};

// The kinds of question as Lofty Lab's tilted panels, which pile up as the page scrolls.
export const QuestionKinds = (): ReactElement => {
  return (
    <section className="wl-kinds" id="kinds" aria-labelledby="wl-kinds-title">
      <h2 className="wl-title" id="wl-kinds-title">Pick a question. They play it out.</h2>
      {KIND_PANELS.map((panel, index) => (
        <KindCard key={panel.kind} panel={panel} index={index} />
      ))}
    </section>
  );
};

// The beat between the kinds and the steps: the line, on a coral ribbon with the two name tags and a coffee cup.
export const FirstCoffee = (): ReactElement => {
  return (
    <section className="wl-coffee" aria-labelledby="wl-coffee-title">
      <h2 className="wl-title" id="wl-coffee-title">
        The awkward first coffee? <em>Your Meetys already had it.</em>
      </h2>
      <div className="wl-ribbon" aria-hidden="true">
        <svg className="wl-ribbon-wave" viewBox="0 0 1000 200" preserveAspectRatio="none" focusable="false">
          <path className="wl-ribbon-path" d="M0 70C140 10 260 150 420 90S700 20 840 80 980 130 1000 110v60C900 200 820 120 680 150S420 200 300 160 120 110 0 160z" />
        </svg>
        <NameTag name="Mira" className="wl-coffee-tag a" />
        <Sticker name="cup" className="wl-coffee-cup" />
        <NameTag name="Jonah" colour="blue" className="wl-coffee-tag b" />
      </div>
    </section>
  );
};
