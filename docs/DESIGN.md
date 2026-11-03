# Design

The look of the Meet First web app. Who it is for and why it looks this way are in [PRODUCT.md](PRODUCT.md). Ambar picked this direction on 27 Oct 2026, from probe 5 ("name tags, Lofty-led, on white").

## The signed-in app: Instagram and ChatGPT (since 3 Nov 2026)

Ambar on 3 Nov: "i wanted it to look like instagram + chatgpt chat combined.... the current ui doesnt look good", with a screenshot of Instagram's 2026 web app. Everything below this section is the landing's look; it stays for the welcome, claim, join and public share pages. Every signed-in page takes the look in `apps/web/src/app-shell/app-look.css`, scoped to `.social-frame`.

- **Frame (Instagram):** on a laptop a 72px white rail of line icons (lucide, 1.8 stroke), the logo at its top, Meety, Explore, Friends and Me in the middle, Settings at its foot; the current page's icon is filled or bold, and each icon's words show beside it on hover and focus. On a phone a top bar with the logo and Settings, and a bottom bar of the four icons with a hairline above it. A red count sits on the Friends icon.
- **Home (an Instagram direct chat with Meety, 3 Nov 2026):** your friends as story circles across the top, a ring in the two voice colours (coral to cobalt) when their Meety can be asked; then the chat, left-aligned, as Instagram opens a chat with someone: Meety's picture (the Meet First logo), its name and "Your personal AI on Meet First" at the top; your messages in blue bubbles on the right; Meety's on the left, its name in small grey over warm grey bubbles and its small logo at the foot of the group; what it plans and what friends' Meetys answer in one card in the kind's colour under its words (yellow for a help search, coral for a friend ask), each answer labelled with whose Meety gave it ("Maya's Meety"); an empty chat opens with Meety's greeting as its first message, your name in coral, and the examples as yellow, coral and blue quick replies under it; the box is a slim pill at the foot with Send in blue words. Ambar on 3 Nov: "make it more and better like instagram", "the response should say meety not maya". Tints are mixed toward the ground in OKLab, never OKLCH, whose hue path turns blue into green; on screens 1160px and wider a right-hand column with you, your friends with Ask, and people Explore suggests with Add friend. <!-- plain-words: allow (his words, quoted) -->
- **Explore, profiles, Friends, Me (Instagram):** Explore is a feed (below); profiles with a round picture (150px laptop, 86px phone), the name, the count, the line, blue and grey buttons, and a hairline tab strip; requests and friends as plain rows.
- **Explore as a feed (3 Nov 2026):** Ambar: "it should have been looking like linkedin or instagram feed", not "an ai generated layout of cards". One column 600px wide, as Threads' and Instagram's feeds: a grey search field, then the newest posts with a hairline between them. A post has its writer's picture in a left column; on the right their name, "· Sample" and the age in words, their line in grey under it, and Add friend in blue words at the end (nothing for a friend); the post in 15px regular; then Ask Meety, when their Meety can be asked, and More from them, grey icon-and-word links. After the second post, "Suggested for you" with See all: cards with a hairline that scroll sideways (to the screen's edges on a phone), each with a 64px picture, the name, the line in two lines and a blue Add friend button. A search, or See all, shows people as hairline rows with their line and first claim, and Back to posts. <!-- plain-words: allow (his words, quoted) -->
- **Posts and sample people (3 Nov 2026):** a profile's Posts tab shows the posts as hairline squares on a laptop and full-width cards on a phone, newest first. A sample person carries a Sample mark beside their name everywhere (grey words after a dot in posts and rows, a small grey pill on a profile), and their profile says under the line that they are not a real person.
- **Tokens:** the system font, an off-white ground (`--ui-bg`, #fffefd = oklch(99.75% 0.002 78.3), also the public pages' `--paper`; Ambar's pick on 3 Nov, first "have off white like #fffcf5", then "use this olor instead of that dark cream everywhere #fffdfa", then "further lighten the off white to 99.75%"; at that lightness sRGB holds a chroma of 0.002 at most), warm near-black ink, one warm grey (`--ui-ink-2`, 5.9:1 on the ground), warm hairlines (`--ui-line`), warm soft fills (`--ui-soft`), Instagram's blue for main buttons (`--ui-blue`, its text in `--ui-bg`), red only for counts and deleting. Nothing in the app is pure white. People are round initials on one of four soft colours their name picks (`PersonAvatar`). Stickers and name tags are hidden in the app except the logo.
- **Me (3 Nov 2026):** Ambar asked for the repeats on /me to go. The profile header has Edit my listing and Your card; under it, the one next step, flat, with the page's one blue button; then the About tab (Add more chats at its end), Posts, and Meetings. Meetings is one list, each row to its brief once ready or else to the meeting, marked "From Explore" when someone met you there, then the open invites. Settings is only the frame's gear.
- **Words (3 Nov 2026):** everyone's AI is their Meety (Ambar chose "Meety for everyone" over "other": "Ask Maya's Meety", "Your Meety meets theirs first"), never persona or agent in the app's words, and the plural is Meetys; Explore, never the directory; quote, never receipt; and a label carries no character count, since the refusal states the limit. Prompts and model tool text keep their own words, because changing them breaks the recorded replies, and three of the database's own refusals (romance_not_open, listing_not_found, directory_self) still say persona or the directory until a migration rewords them.
- **No boxes (3 Nov 2026):** Ambar: "unnecessary curved boxes some places inside are showing ai slop". In the app a `.panel`, `.soft-panel` or `.colour-panel` is a section with space around it, and two sections meet at a hairline; only a dialog keeps a box. A quote is the words in quotation marks with the source under them, never a card. A box stays only where it groups one thing the person acts on: an input, the chat box, a suggested person's card in Explore, a sticky action bar. No card inside a card, no pill label on top of a box, no box round one line, an empty state or a list that already has hairlines. Kinds and statuses are grey words, never coloured pills, and nothing is green. The public pages (welcome, share, join, claim) keep the landing's look; every app override sits under `.social-frame`.
- **Kept rules:** curved corners on everything that stays a box (buttons 10px, tiles 14px, dialogs 20px, the chat box and chips pills), text 13px and up, no all caps, no em dashes, one main action per screen.

## The idea

The look comes from one thing in Meet First's own world: the "Hello, my name is" sticker everyone wears on day one of a hackathon.

- The sign-up form is a blank name tag you write your name on.
- Home greets you with your own tag.
- Every meeting puts two tags side by side.
- The logo is two tags, overlapping.

The layout follows Lofty Lab:

- a sky that fades to white over a cloud edge;
- stickers on the headline;
- tilted colour panels that pile up;
- chat bubbles with faces at the corners;
- puffy pills.

The ground is bright white. The two voices of a meeting are coral and blue.

Rule of thumb: play in the moments, plain in the tasks. Stickers, tilts, typing dots and the sky belong to:

- the welcome;
- the top of a meeting;
- the brief;
- the empty states.

Forms, switches, lists and settings stay quick and familiar.

## Colour

The colour strategy is a full palette. Tokens live in `apps/web/src/app-shell/app.css` and nothing else defines a colour.

| Token | Use |
|---|---|
| `--paper` | The ground of every page. Bright white, never grey. |
| `--ink` | All text and every outline. Navy, not black. |
| `--ink-2`, `--ink-3` | Secondary text, and numbers or labels in lists. |
| `--coral`, `--coral-deep` | The first person's voice (meeting side a): bubbles in `--coral`, name tag bands and avatars in `--coral-deep`. |
| `--blue`, `--blue-deep` | The second person's voice (side b), and every main button. |
| `--green`, `--yellow`, `--lilac` | They mark question kinds and colour panels. They are never a voice. |
| `--*-soft` | Quiet panels behind lists and status rows. |
| `--coral-ink` | The one coral word in the welcome headline (large text only). |

Contrast is checked: `--ink` on every colour token is 6.8:1 or more, and `--paper` on every `-deep` band is 4.6:1 or more. Never put `--ink-3` on a colour panel, and never put white text on a light colour.

Colour classes set `--c` (the deep colour), `--k` (the panel colour) and `--k-soft` on an element: `c-coral`, `c-blue`, `c-green`, `c-lilac` and `c-yellow`. Use them instead of inline styles; the CSP forbids those.

## Type

| Face | Variable | Use |
|---|---|---|
| Bricolage Grotesque 800 | `--display` | Every heading, h1 to h3, and big numbers. Sentence case, tight (-0.035em). |
| Hanken Grotesk 400 to 700 | `--sans` | All body text, labels and buttons. |
| Shantell Sans 700 | `--hand` | Only names written on tags, the recovery code, and at most one hand note per screen. |

The fonts are self-hosted (`@fontsource-variable/*`, imported in `start-app.tsx`). Never all caps, never monospace, never a condensed face.

## Shape and depth

- **Corners.** Everything is curved: buttons and chips are pills; cards and panels are 20 to 28px; inputs are 16px. There are no square corners anywhere.
- **Outlines.** They are 2px `--ink`. They mark things you act on or read closely: buttons, inputs, white cards.
- **Tilts.** Colour panels tilt between -2deg and 2deg. Tags and stickers tilt up to 12deg. Text blocks never tilt.
- **Shadows.** One soft drop (`--lift`) on things that sit on top: tags, quote cards, the tab bar and sticky notes.

## Parts

Classes are in `app.css`; React parts are in `apps/web/src/look/`.

| Part | How |
|---|---|
| Name tag | `<NameTag name colour className />`. Size it with `--s` and tilt it with `--r`, set in a screen class. |
| Sticker | `<Sticker name="chat" />`, drawn from `<StickerSheet />`, which the app renders once. Names: chat, tags, laptop, smile, cup, quote, soap, check, spark, phone, poof, nope, house, buoy, gear, lens, plane, pencil, ask, coins. |
| Person | `<Avatar name side />`: the initial on a circle in the side's colour. People never have photos. |
| Voice bubble | `.talk` > `.msg.a` or `.msg.b`, each holding an `.avatar`, a `.bubble` (with `.who` first) and an `.extra` for quote cards. |
| Quote | `<Receipt quote source onOpen? />`. It is a button when it opens the source message. |
| Missing or weak quote | `<ReceiptFlag isWeak />`. The words come from contracts (`no quote`, `weak quote`). |
| Buttons | `button` and `.btn` are the main action (blue pill, navy outline). `.quiet` is white, `.coral` is coral, `.danger` is for deleting, `.text-button` is a link-looking button, and `.big` is larger. One main action per screen. |
| Surfaces | `.panel` is white with a navy outline. `.colour-panel` uses a colour class and `--r`. `.soft-panel` is quiet. `.sticky-note` is the yellow note. `.rows` is a numbered hairline list. |
| Marks | `.chip` (outlined, colour from `--c`), `.pill` (a status), `.dot`, `.mark` (inline flags). |
| Sky | `.sky` with a `.scallop` at the bottom (or `.scallop.top`) and `<Cloud className />`. |
| States | `<EmptyState sticker title action />` and `<LoadingLine text />`. Errors use `ErrorNotice` (`.notice`). |
| Frame | `ScreenFrame title isWide titleAside`: the top bar with the logo, the h1, and the Pages nav (a tab bar on phones, a pill at the top right on laptops). `titleAside` sits beside the h1, for example the name tag on Home. |
| Question kinds | `KIND_LOOK[kind]` gives each kind's words, colour class and sticker: getting along green, help yellow, deal and decision coral, debate and situation lilac, a first date blue. |

## Every screen has

- One main action, visible in the first phone screen.
- A loading state that says what it is waiting for (`LoadingLine`), never a blank page.
- An empty state with a sticker, one line, and the next step (`EmptyState`).
- An error state that says what happened in plain words, plus a way on (`ErrorNotice`, a retry or a link).
- Targets of at least 44px, and visible keyboard focus (`:focus-visible` draws a blue outline).
- Nothing that moves when the person prefers reduced motion; `app.css` stops all animation then.

## Screens at two widths

Phones first (390px), then laptops (1280px). The screen gallery shows every screen in every state from test data:

```bash
pnpm exec tsx scripts/screen-gallery.ts --only home,meeting --out /tmp/screens
```

Each screen folder adds its states as `apps/web/src/testing/gallery/views/<screen>.tsx`, exporting `views`. The gallery collects every file in that folder.

- A state that needs a click or typing gets a `play` step, which runs a moment after the screen appears. `typeInto(label, value)` and `press(buttonText)` come from `gallery-views.ts`.
- A route with no stub answers 404, which shows the error state. A stub with `delayMs: FOREVER_MS` holds the loading state.

## Words

- Plain words and short sentences. No em dashes.
- Agents and personas say "probably", never "will".
- Never a number about a person: no score, rank, percent or match count.
- Copy that tests assert stays word for word. Change it only when a design fix needs it, and change the test in the same commit.

## Never

- Grey page grounds, black (`#000`) or pure white (`#fff`).
- Side-stripe borders, gradient text, glass cards, identical card grids, or cards nested in cards.
- All caps, monospace, condensed faces, eyebrow labels over every section.
- Hearts, flames or percent badges anywhere near a person, including dating.
- Photos of people. Ambar chose no photos on 27 Oct, so people show as initials and name tags.
- Inline `style` attributes in markup. Set custom properties from a class instead.
  - Two known exceptions remain. A test reads the comic panel grid's column count and the comic image width from inline style values. React sets these through the DOM, which the CSP allows. They can go once those tests read classes instead.
