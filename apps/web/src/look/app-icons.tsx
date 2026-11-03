// The signed-in app's line icons and round avatars, the look of Instagram and ChatGPT that Ambar asked for on 3 Nov 2026 ("instagram +
// chatgpt chat combined"). Icons come from lucide at one size and stroke; a person is the first letter of their name on a soft circle in
// one of four colours that their name picks, so the same person always looks the same, and a sample person is their face with the
// orange made-up mark. The landing keeps the name tags and stickers.
import type { ReactElement } from "react";
import { ArrowRight, ArrowUp, Check, ChevronLeft, ChevronRight, Compass, Grid3x3, Handshake, Heart, House, ImagePlus, LayoutGrid, MessageCircle, Plus, Quote, Rows3, Search, Settings, Sparkles, SquarePlus, UserPlus, UserRound, Users, X } from "lucide-react";
import { initialOf } from "./look-parts.js";
import { photoOf, photoUrl } from "./sample-photos.js";
import { Sticker } from "./stickers.js";

// Every icon the app draws, by what it means here.
const ICONS = {
  home: House,
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
  meetings: Handshake,
  next: ChevronRight,
  grid: Grid3x3,
  list: Rows3,
  plus: Plus,
  arrow: ArrowRight,
  invite: SquarePlus,
  create: SquarePlus,
  photo: ImagePlus,
  heart: Heart,
  back: ChevronLeft,
  close: X,
} as const;
// The name of one icon.
export type IconName = keyof typeof ICONS;
// The icons that are drawn filled when they mark the current page, as Instagram fills its current page's icon; the others go bold.
const FILLED_WHEN_CURRENT: ReadonlySet<IconName> = new Set(["home", "meety", "friends", "me"]);

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

// A person as a round picture: their face when there is one (only sample people have one so far), else their first letter on their
// colour; a sample person also carries a small orange asterisk at the top right, so nobody takes a made-up face for a real one (Ambar,
// 3 Nov 2026: "a small orange colored * near their head so we know"). Hidden from screen readers, because their name, and the Sample
// mark in words, are always next to it.
export const PersonAvatar = (props: { name: string; size?: AvatarSize; className?: string; photo?: string | null | undefined; isSample?: boolean | undefined }): ReactElement => {
  const url = photoUrl(props.photo);
  const classes = ["person-avatar", `size-${props.size ?? "m"}`, tintOf(props.name), url === null ? "" : "has-photo", props.className ?? ""].filter((part) => part !== "").join(" ");
  return (
    <span className={classes} aria-hidden="true">
      {url === null ? initialOf(props.name) : <img src={url} alt="" loading="lazy" />}
      {props.isSample === true ? <MadeUpMark /> : null}
    </span>
  );
};

// The shape class of a photo by its size: square, tall or wide.
function shapeOf(photo: { width: number; height: number }): "is-square" | "is-tall" | "is-wide" {
  if (photo.height === photo.width) return "is-square";
  return photo.height > photo.width ? "is-tall" : "is-wide";
}

// A post's photo, with square corners (Ambar, 3 Nov 2026: "instead of curved edges photos and reels use square"): a wide photo at 3:2, a
// tall one at 4:5 on a phone and square on wider screens, and a photo a person shared square. Nothing shows for a key this build does
// not have.
export const PostPhoto = (props: { photo: string | null | undefined; alt: string | null | undefined; className?: string }): ReactElement | null => {
  const found = photoOf(props.photo);
  if (found === null) return null;
  const classes = ["post-photo", shapeOf(found), props.className ?? ""].filter((part) => part !== "").join(" ");
  return (
    <div className={classes}>
      <img src={found.src} alt={props.alt ?? ""} width={found.width} height={found.height} loading="lazy" decoding="async" />
    </div>
  );
};

// A story's picture, after Instagram's: a tall 9:16 frame with square corners holding the whole photo on a blurred, darkened copy of
// itself, so a wide photo shows whole, with the story's words over the foot of it; a story of words alone shows them large on the warm
// card. alt is what a screen reader reads for the photo.
export const StoryPicture = (props: { src: string | null; alt: string; text: string; className?: string }): ReactElement => {
  const classes = ["story-picture", props.src === null ? "is-words" : "", props.className ?? ""].filter((part) => part !== "").join(" ");
  return (
    <div className={classes}>
      {props.src === null ? null : (
        <>
          <img className="story-picture-backdrop" src={props.src} alt="" aria-hidden="true" />
          <img className="story-picture-photo" src={props.src} alt={props.alt} />
        </>
      )}
      {props.text === "" ? null : <p className="story-picture-words">{props.text}</p>}
    </div>
  );
};

// The orange asterisk on a made-up person's picture: three crossed strokes, as in the "Other" concept's wordmark.
const MadeUpMark = (): ReactElement => {
  return (
    <svg className="made-up-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />
    </svg>
  );
};

// The mark on every sample person (migration 0009): a made-up person seeded so Explore has people to try, never shown as a real one.
export const SampleChip = (): ReactElement => {
  return <span className="sample-chip">Sample</span>;
};

// Meety's own small picture: a sparkle on a dark circle, next to each of its replies.
export const MeetyMark = (props: { size?: AvatarSize }): ReactElement => {
  return (
    <span className={`meety-mark size-${props.size ?? "s"}`} aria-hidden="true">
      <Sticker name="tags" />
    </span>
  );
};
