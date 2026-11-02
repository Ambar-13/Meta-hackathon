// The signed-in app's line icons and round avatars, the look of Instagram and ChatGPT that Ambar asked for on 3 Nov 2026 ("instagram +
// chatgpt chat combined"). Icons come from lucide at one size and stroke; a person is the first letter of their name on a soft circle in
// one of four colours that their name picks, so the same person always looks the same. The landing keeps the name tags and stickers.
import type { ReactElement } from "react";
import { ArrowUp, Check, Compass, LayoutGrid, MessageCircle, Quote, Search, Settings, Sparkles, UserPlus, UserRound, Users } from "lucide-react";
import { initialOf } from "./look-parts.js";

// Every icon the app draws, by what it means here.
const ICONS = {
  meety: MessageCircle,
  explore: Compass,
  friends: Users,
  me: UserRound,
  settings: Settings,
  search: Search,
  send: ArrowUp,
  add: UserPlus,
  check: Check,
  spark: Sparkles,
  posts: LayoutGrid,
  about: Quote,
} as const;
// The name of one icon.
export type IconName = keyof typeof ICONS;
// The icons that are drawn filled when they mark the current page, as Instagram fills its current page's icon; the others go bold.
const FILLED_WHEN_CURRENT: ReadonlySet<IconName> = new Set(["meety", "friends", "me"]);

// One line icon, hidden from screen readers because the words next to it say what it is. isBold draws the current page's icon.
export const Icon = (props: { name: IconName; size?: number; isBold?: boolean; className?: string }): ReactElement => {
  const Drawn = ICONS[props.name];
  const className = props.className === undefined ? "icon" : `icon ${props.className}`;
  const isFilled = props.isBold === true && FILLED_WHEN_CURRENT.has(props.name);
  return <Drawn aria-hidden="true" focusable="false" size={props.size ?? 24} strokeWidth={props.isBold === true ? 2.4 : 1.8} fill={isFilled ? "currentColor" : "none"} className={className} />;
};

// The four colours a person's circle can take; each class sets --c (the letter) and --k-soft (the circle) in app.css.
const TINTS = ["c-blue", "c-coral", "c-lilac", "c-yellow"] as const;

// The colour class a name picks: the same name always gets the same colour. Example: "Mira" always gets the same one of the four.
export function tintOf(name: string): (typeof TINTS)[number] {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  return TINTS[hash % TINTS.length] ?? "c-blue";
}

// A person's sizes: s for lists (32 px), m for rows (44 px), l for a phone profile (86 px), xl for a laptop profile (150 px).
export type AvatarSize = "s" | "m" | "l" | "xl";

// A person as a round picture: their first letter on their colour. Hidden from screen readers, because their name is always next to it.
export const PersonAvatar = (props: { name: string; size?: AvatarSize; className?: string }): ReactElement => {
  const classes = ["person-avatar", `size-${props.size ?? "m"}`, tintOf(props.name), props.className ?? ""].filter((part) => part !== "").join(" ");
  return (
    <span className={classes} aria-hidden="true">
      {initialOf(props.name)}
    </span>
  );
};

// Meety's own small picture: a sparkle on a dark circle, next to each of its replies.
export const MeetyMark = (props: { size?: AvatarSize }): ReactElement => {
  return (
    <span className={`meety-mark size-${props.size ?? "s"}`} aria-hidden="true">
      <Icon name="spark" size={props.size === "m" ? 22 : 16} />
    </span>
  );
};
