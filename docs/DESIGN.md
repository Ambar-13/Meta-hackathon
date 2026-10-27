# Design

The look of the Meet First web app. Who it is for and why it looks this way are in [PRODUCT.md](PRODUCT.md). Ambar picked this direction on 27 Oct 2026, from probe 5 ("name tags, Lofty-led, on white").

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
| Missing or weak quote | `<ReceiptFlag isWeak />`. The words come from contracts (`no receipt`, `weak receipt`). |
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
