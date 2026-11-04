import type { ReactElement } from "react";

// Every sticker the app draws. Each one is a small piece of drawn art with a navy outline, in the palette of docs/DESIGN.md.
export type StickerName =
  | "chat"
  | "tags"
  | "laptop"
  | "smile"
  | "cup"
  | "quote"
  | "soap"
  | "check"
  | "spark"
  | "phone"
  | "poof"
  | "nope"
  | "house"
  | "buoy"
  | "gear"
  | "lens"
  | "plane"
  | "pencil"
  | "ask"
  | "coins";

// One sticker, drawn from the sheet below. It is decoration, so screen readers skip it unless a label is given.
export const Sticker = (props: {
  name: StickerName;
  label?: string;
  className?: string;
}): ReactElement => {
  const className = props.className === undefined ? "stk" : `stk ${props.className}`;
  if (props.label === undefined) {
    return (
      <svg className={className} aria-hidden="true" focusable="false">
        <use href={`#s-${props.name}`} />
      </svg>
    );
  }
  return (
    <svg className={className} role="img" aria-label={props.label} focusable="false">
      <use href={`#s-${props.name}`} />
    </svg>
  );
};

// The drawings behind every sticker, and the die-cut filter that gives each one its white edge. Rendered once per page.
// eslint-disable-next-line max-lines-per-function -- SVG drawings, one symbol per sticker, not logic
export const StickerSheet = (): ReactElement => {
  return (
    <svg className="sticker-sheet" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        <filter id="diecut" x="-30%" y="-30%" width="160%" height="160%">
          <feMorphology in="SourceAlpha" operator="dilate" radius="3.2" result="spread" />
          <feFlood floodColor="#fdfcfa" />
          <feComposite in2="spread" operator="in" result="edge" />
          <feMerge>
            <feMergeNode in="edge" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <symbol id="s-chat" viewBox="0 0 64 64">
          <path
            className="stk-o f-blue"
            d="M27 7h25a8 8 0 0 1 8 8v13a8 8 0 0 1-8 8h-3l2 8-11-8H27a8 8 0 0 1-8-8V15a8 8 0 0 1 8-8z"
          />
          <path
            className="stk-o f-coral"
            d="M11 21h25a8 8 0 0 1 8 8v13a8 8 0 0 1-8 8H23l-11 8 2-8h-3a8 8 0 0 1-8-8V29a8 8 0 0 1 8-8z"
          />
          <circle className="f-ink" cx="16" cy="36" r="2.7" />
          <circle className="f-ink" cx="23.5" cy="36" r="2.7" />
          <circle className="f-ink" cx="31" cy="36" r="2.7" />
        </symbol>
        <symbol id="s-tags" viewBox="0 0 64 64">
          <g transform="rotate(-12 22 34)">
            <rect className="stk-o f-paper" x="5" y="18" width="34" height="26" rx="5" />
            <path className="f-coral-deep" d="M6.5 19.5h31v8h-31z" />
          </g>
          <g transform="rotate(10 42 32)">
            <rect className="stk-o f-paper" x="25" y="17" width="34" height="26" rx="5" />
            <path className="f-blue-deep" d="M26.5 18.5h31v8h-31z" />
            <path className="stk-o f-none" d="M32 35c3-3 5 2 8-1s5 2 9-1" strokeWidth="2.4" />
          </g>
        </symbol>
        <symbol id="s-laptop" viewBox="0 0 64 64">
          <rect className="stk-o f-green" x="12" y="12" width="40" height="28" rx="4" />
          <path className="stk-o f-paper" d="M5 46h54l-4 7H9z" />
          <path
            className="stk-o f-yellow"
            d="M32 19l2.3 4.9 5.2.6-3.9 3.5 1.1 5.2-4.7-2.7-4.7 2.7 1.1-5.2-3.9-3.5 5.2-.6z"
            strokeWidth="2.2"
          />
        </symbol>
        <symbol id="s-smile" viewBox="0 0 64 64">
          <circle className="stk-o f-yellow" cx="32" cy="32" r="25" />
          <circle className="f-pink" cx="18" cy="37" r="5" />
          <circle className="f-pink" cx="46" cy="37" r="5" />
          <path className="stk-o f-none" d="M22 27v1M42 27v1" />
          <path className="stk-o f-none" d="M22 38c5 7 15 7 20 0" />
        </symbol>
        <symbol id="s-cup" viewBox="0 0 64 64">
          <path
            className="stk-o f-lilac"
            d="M12 26h34v14a13 13 0 0 1-13 13h-8a13 13 0 0 1-13-13z"
          />
          <path className="stk-o f-none" d="M46 30h4a6 6 0 0 1 0 12h-5" />
          <path
            className="stk-o f-none"
            d="M22 8c-3 4 3 6 0 11M31 6c-3 4 3 7 0 12M40 8c-3 4 3 6 0 11"
            strokeWidth="2.6"
          />
        </symbol>
        <symbol id="s-quote" viewBox="0 0 64 64">
          <rect className="stk-o f-coral" x="6" y="8" width="52" height="46" rx="16" />
          <path
            className="f-paper"
            d="M17 39c0-8 4-14 10-17l2 4c-3 2-5 4-5 7h5v9H17zM34 39c0-8 4-14 10-17l2 4c-3 2-5 4-5 7h5v9H34z"
          />
        </symbol>
        <symbol id="s-soap" viewBox="0 0 64 64">
          <rect className="stk-o f-pink" x="8" y="28" width="40" height="24" rx="9" />
          <circle className="stk-o f-paper" cx="44" cy="20" r="8" strokeWidth="2.5" />
          <circle className="stk-o f-paper" cx="55" cy="10" r="4.5" strokeWidth="2.5" />
          <circle className="stk-o f-paper" cx="30" cy="18" r="5" strokeWidth="2.5" />
        </symbol>
        <symbol id="s-check" viewBox="0 0 64 64">
          <circle className="stk-o f-green" cx="32" cy="32" r="24" />
          <path className="stk-o f-none" d="M21 33l7 7 15-16" strokeWidth="5" />
        </symbol>
        <symbol id="s-spark" viewBox="0 0 64 64">
          <path
            className="stk-o f-yellow"
            d="M32 5c3 15 9 22 25 27-16 5-22 12-25 27-3-15-9-22-25-27 16-5 22-12 25-27z"
          />
        </symbol>
        <symbol id="s-phone" viewBox="0 0 64 64">
          <rect className="stk-o f-paper" x="16" y="4" width="32" height="56" rx="8" />
          <rect
            className="stk-o f-coral"
            x="20"
            y="16"
            width="18"
            height="10"
            rx="5"
            strokeWidth="2.2"
          />
          <rect
            className="stk-o f-blue"
            x="26"
            y="30"
            width="18"
            height="10"
            rx="5"
            strokeWidth="2.2"
          />
          <path className="stk-o f-none" d="M28 9h8" strokeWidth="2.4" />
        </symbol>
        <symbol id="s-poof" viewBox="0 0 64 64">
          <path
            className="stk-o f-paper"
            d="M16 46a10 10 0 0 1-1-20 13 13 0 0 1 24-6 10 10 0 0 1 15 9 9 9 0 0 1-3 17z"
          />
          <path className="stk-o f-none" d="M8 12l3 3M54 8l-2 4M58 50l-4-2" strokeWidth="2.6" />
        </symbol>
        <symbol id="s-nope" viewBox="0 0 64 64">
          <rect className="stk-o f-lilac" x="7" y="10" width="50" height="44" rx="14" />
          <path className="stk-o f-none" d="M20 26h24M20 38h16" strokeWidth="3.2" />
          <path className="stk-o f-none" d="M14 50L50 14" strokeWidth="4" />
        </symbol>
        <symbol id="s-house" viewBox="0 0 64 64">
          <path
            className="stk-o f-yellow"
            d="M9 31L32 11l23 20v21a4 4 0 0 1-4 4H13a4 4 0 0 1-4-4z"
          />
          <rect className="stk-o f-coral" x="26" y="38" width="12" height="18" rx="2" />
        </symbol>
        <symbol id="s-buoy" viewBox="0 0 64 64">
          <circle className="f-none k-coral" cx="32" cy="32" r="17.5" strokeWidth="13" />
          <circle
            className="f-none k-paper"
            cx="32"
            cy="32"
            r="17.5"
            strokeWidth="13"
            strokeDasharray="9 18.5"
          />
          <circle className="stk-o f-none" cx="32" cy="32" r="24" />
          <circle className="stk-o f-none" cx="32" cy="32" r="11" />
        </symbol>
        <symbol id="s-gear" viewBox="0 0 64 64">
          <circle
            className="f-none k-ink"
            cx="32"
            cy="32"
            r="22"
            strokeWidth="9"
            strokeDasharray="7.6 9.67"
          />
          <circle className="stk-o f-lilac" cx="32" cy="32" r="18" />
          <circle className="stk-o f-paper" cx="32" cy="32" r="7" />
        </symbol>
        <symbol id="s-lens" viewBox="0 0 64 64">
          <path className="stk-o f-none" d="M41 41l13 13" strokeWidth="7" />
          <circle className="stk-o f-sky" cx="27" cy="27" r="17" />
          <path className="f-paper" d="M18 24a10 10 0 0 1 8-8l1 4a6 6 0 0 0-5 5z" />
        </symbol>
        <symbol id="s-plane" viewBox="0 0 64 64">
          <path className="stk-o f-paper" d="M6 30L58 8 46 56 32 40z" />
          <path className="stk-o f-blue" d="M32 40l26-32-36 30z" />
          <path className="stk-o f-none" d="M32 40l-4 14 10-9" />
        </symbol>
        <symbol id="s-pencil" viewBox="0 0 64 64">
          <path className="stk-o f-yellow" d="M14 42L42 14l8 8-28 28z" />
          <path className="stk-o f-pink" d="M42 14l5-5a3 3 0 0 1 4 0l4 4a3 3 0 0 1 0 4l-5 5z" />
          <path className="stk-o f-paper" d="M14 42l-5 13 13-5z" />
        </symbol>
        <symbol id="s-ask" viewBox="0 0 64 64">
          <path
            className="stk-o f-green"
            d="M14 8h36a8 8 0 0 1 8 8v22a8 8 0 0 1-8 8H30l-12 10 2-10h-6a8 8 0 0 1-8-8V16a8 8 0 0 1 8-8z"
          />
          <path className="stk-o f-none" d="M26 22a6 6 0 1 1 8 6c-2 1-2 2-2 4" strokeWidth="3.4" />
          <circle className="f-ink" cx="32" cy="38" r="2.4" />
        </symbol>
        <symbol id="s-coins" viewBox="0 0 64 64">
          <ellipse className="stk-o f-yellow" cx="32" cy="46" rx="20" ry="8" />
          <path className="stk-o f-yellow" d="M12 37v9c0 4 9 8 20 8s20-4 20-8v-9" />
          <ellipse className="stk-o f-yellow" cx="32" cy="36" rx="20" ry="8" />
          <path className="stk-o f-yellow" d="M12 26v10c0 4 9 8 20 8s20-4 20-8V26" />
          <ellipse className="stk-o f-yellow" cx="32" cy="25" rx="20" ry="8" />
        </symbol>
        <symbol id="s-cloud" viewBox="0 0 120 60">
          <path
            className="f-paper"
            d="M18 58a17 17 0 0 1 1-34 22 22 0 0 1 40-10 18 18 0 0 1 31 6 17 17 0 0 1 12 38z"
          />
          <path
            className="f-sky"
            d="M10 50c8 6 20 8 30 7h62a17 17 0 0 0 13-15c-4 8-11 11-18 11H35c-9 0-18-1-25-3z"
          />
        </symbol>
      </defs>
    </svg>
  );
};

// One drifting cloud for the sky grounds; each place that uses it sets its size and position with a class.
export const Cloud = (props: { className: string }): ReactElement => {
  return (
    <svg className={`cloud ${props.className}`} aria-hidden="true" focusable="false">
      <use href="#s-cloud" />
    </svg>
  );
};
