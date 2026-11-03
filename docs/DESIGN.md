# Design

The look of the Meety web app. Who it is for and why it looks this way are in [PRODUCT.md](PRODUCT.md). Ambar picked this direction on 27 Oct 2026, from probe 5 ("name tags, Lofty-led, on white").

## The signed-in app: Instagram and ChatGPT (since 3 Nov 2026)

Ambar on 3 Nov: "i wanted it to look like instagram + chatgpt chat combined.... the current ui doesnt look good", with a screenshot of Instagram's 2026 web app. Everything below this section is the landing's look; it stays for the welcome, claim, join and public share pages. Every signed-in page takes the look in `apps/web/src/app-shell/app-look.css`, scoped to `.social-frame`.

- **Pages, as Instagram's (3 Nov 2026):** Ambar: "explore should be the like default page... and it shouldnt be called eplroe because has feed + explroe both", no tabs on it ("just liek social media"), "there is no search button to find poeple and send then friend requests like insta", and "like instagram you had the logo centred". So the pages are Home (`/home`, the feed and the signed-in start), Search (`/search`: the search box, which finds people by the start of their name first and then by the words of their line and public items, the people as rows with Add friend, six suggested with See everyone, and the photos under "Explore" as Instagram's grid), Meety (`/meety`, the chat), Friends, Create (`/create`) and Me, in that order; `/explore` and `/directory` lead to Search. On a phone the top bar is Instagram's: Create (a plus in a square) at the left, the logo in the middle, Settings at the right, and the bottom pill keeps its five icons, since Create lives in the top bar there. <!-- plain-words: allow (his words, quoted) -->
- **Frame (3 Nov 2026, after the "Other" concept Ambar liked):** at 1200px and wider a 248px sidebar: the name-tag mark and "Meety" in Bricolage, the tagline "Your Meety meets theirs first.", the pages with icon and words (the current one on the soft fill, the request count at the row's end), a blue "Invite a friend" pill, Settings at the foot, and "Your Meety · Shares only what you choose" under a hairline. From 768px to 1200px the narrow Instagram rail of icons, each icon's words on hover. On a phone a top bar with the logo and Settings, and, as Instagram's app since 2025, a frosted pill of icons floating over the foot of the page, the current page's icon bold on a round grey patch, the request count as a small red badge, and each icon's words kept for screen readers only (Ambar: "also study instagrams tab (the navigation pane down)"). <!-- plain-words: allow (his words, quoted) -->
- **Home (an Instagram direct chat with Meety, 3 Nov 2026):** your friends as story circles across the top, a ring in the two voice colours (coral to cobalt) when their Meety can be asked; then the chat, as Instagram opens a chat with someone: Meety's picture (the app's logo on an 88px soft circle), its name and "Your personal AI" at the top. Ambar on 3 Nov: "make it more and better like instagram", "the response should say meety not maya", then "the logo can be in line with meety and the message can be more left ... no need so much indented" and "I WANT THE UI DESIGN QUALITY TO AT LEAST SURPASS INSTAGRAM". So the thread: a small grey time line ("Today 2:41 PM", "Yesterday", the weekday, then the date) at the top and wherever the chat paused 30 minutes; your messages in blue pill bubbles on the right; Meety's in warm grey pill bubbles from the left edge, its 28px logo in line with "Meety" over each run of its messages; a run sits 2px apart with its joined corners tucked to 6px, as Instagram groups messages, and runs sit 16px apart. What Meety plans, and what friends' Meetys answer, sit in a card with a hairline under its words, as Instagram shows a shared post: the kind's icon on a round patch of its colour (a magnifier on yellow for "Finding who could help", a speech bubble on coral for "Asking Mira's Meety"), the question in quotation marks, the consent line and one full-width blue button, or the answers with a hairline between them and "See all the answers". An empty chat opens with Meety's greeting (your name in coral) and the examples as quick replies stacked under it, hairline pills with their kind's icon patch. The box is a filled pill at the foot with a round blue Send arrow, grey until there is something to send. Tints are mixed toward the ground in OKLab, never OKLCH, whose hue path turns blue into green; on screens 1160px and wider a right-hand column with you (View), your friends with Ask, and people Explore suggests with Add friend. <!-- plain-words: allow (his words, quoted) -->
- **Explore, profiles, Friends, Me (Instagram):** Explore is a feed (below); profiles with a round picture (150px laptop, 86px phone), the name, the count, the line, blue and grey buttons, and a hairline tab strip; requests and friends as plain rows.
- **Home, the feed (3 Nov 2026; Explore until then):** Ambar: "it should have been looking like linkedin or instagram feed", then, the same day, "I WANT THE OTHERS AND INSTAGRAM LOOK" and, for the phone, Instagram's app. So the page follows the "Other" concept's measures: "People, not just posts." in small grey over the title "Home" (40px, weight 500, -0.045em) with today's date at the right, which a phone leaves out as Instagram does; your next step while your card is not approved; the row of stories (below); then the posts, with no tabs. A post has a header (the 44px picture, the name, "· 2 hours ago", the line in grey, Add friend in blue words at the end, nothing for a friend); its words in 16px over its photo, or, with no photo, its words large (24px, weight 500) on the warm card (`--ui-sand`); the soft strip "From what NAME shared" with their own words when one of their public items shares a word with the post; and Ask NAME's Meety (the chat with a friend ask when their Meety can be asked, else one line under the post saying why) and Posts. The photos, as Instagram's Explore grid (every photo post as a 3:4 tile with square corners, three to a row, 3px apart, each opening its writer's Posts tab), are on Search. On a phone the photos, the faces and the grid run to the screen's edges, and "Suggested for you" cards sit after the second post. At 1200px and wider a 300px right-hand column: the warm card "You're more than your posts." with three thin circles turning slowly in its corner and "See what it shares" (Me) in a pill, then "People you might click with" (up to four people who are not friends yet, each with Add friend) with See everyone, which opens Search, as See all does on the phone's cards. Left out of the concept: capitals, type under 13px, made-up counts of likes and comments, green, and photo captions it made up. <!-- plain-words: allow (his words, quoted) -->
- **Posts, photos and sample people (3 Nov 2026):** photos have square corners where every other surface is round (Ambar: "instead of curved edges photos and reels use square"): a wide photo at 3:2, a tall one at 4:5 on a phone and square on wider screens. A profile's Posts tab opens as Instagram's profile grid (3:4 tiles, three to a row, 3px apart, a post of words as its words on the warm card) when any post has a photo, with a Grid and List switch; a tile opens its post in the list. Posts of words alone are the list. Sample people have faces: free Unsplash portraits (credits in `docs/sample-photos.md`), each with a small orange asterisk at the top right of the picture, as Ambar asked ("use cute human avatars photo for these people we are egenrating witha. small orange colored * near their head so we know"); a post says "Sample person" to screen readers, and a card, a row and a profile keep the Sample word, the profile saying under the line that they are not a real person. Real people show the photo they put up in Edit profile, or else their initials. <!-- plain-words: allow (his words, quoted) -->
- **Posts, stories and likes by everyone (3 Nov 2026):** Ambar: "can people share story and post also? like insta? their agent can learn from those as well about what they like and what they post". Create (`/create`, the + of the phone's top bar and of the laptop's rail) has Instagram's two choices, Post and Story, as a pill switch; then the place to choose a photo, the size of what it becomes, which also says "Or share words alone."; the words; a line with Meety's mark, "Your Meety reads what you share and the posts you like, to learn what you are into."; while you are not in Explore, "Only you see your posts until you join Explore."; then Share, full width and the page's one blue; and "Invite a friend instead" under it. The browser draws a post's photo as a 1080px square and a story's as the whole picture at most 1080px wide, both as JPEGs, which leaves behind any camera or location data. A story shows for 24 hours. Home's row of faces is Instagram's stories row: Your story first (your picture, a dashed ring and a blue plus, opening Create on Story; once you have a story it opens your stories), then each person with a story, new ones first, friends first, real before sample people, a 2px ink ring while one is new to you and a hairline once watched (the browser remembers what you watched). Sample people's story is their newest photo post. A story opens in a viewer over the whole page on a phone and as a 9:16 card on a dark ground on a laptop: a bar per story, the face, name and age ("Sample person" for a sample's), Pause or Play and Close; the whole photo on a blurred, darkened copy of itself with the words over a soft shade at its foot, or words alone large on the warm card; Previous on the left third, Next on the rest, the arrow keys, and Escape; each story moves on after 5 seconds unless paused or the person asks their system for less motion; at the foot See profile, or on your own Delete story and Add to your story. Every post has Like first under it, the heart filled red once liked, as Instagram's; nobody sees a count or a list of who liked it. Your own post has no Add friend or Ask, its Posts leads to your own Posts tab, and Delete asks once more before it deletes. A post's photo with no words shows alone. On Me, Posts lists your own posts with New post and Delete, whether or not you are in Explore; an empty Posts tab says "Share your first post" on yours and "No posts yet" on someone else's. <!-- plain-words: allow (his words, quoted) -->
- **Tokens:** Hanken Grotesk (the landing's own sans) with page titles large and light (36px, weight 500, -0.03em; 30px on a phone), an off-white ground (`--ui-bg`, #fffefd = oklch(99.75% 0.002 78.3), also the public pages' `--paper`; Ambar's pick on 3 Nov, first "have off white like #fffcf5", then "use this olor instead of that dark cream everywhere #fffdfa", then "further lighten the off white to 99.75%"; at that lightness sRGB holds a chroma of 0.002 at most), warm near-black ink, one warm grey (`--ui-ink-2`, 5.9:1 on the ground), hairlines (`--ui-line`) and soft fills (`--ui-soft`) at the ground's hue and a low chroma, so they read grey, not beige, Instagram's blue for main buttons (`--ui-blue`, its text in `--ui-bg`), red only for counts, deleting and a liked heart, the "Other" concept's warm card (`--ui-sand`, after its #eee9df) for a post of words and the card on what your Meety does, and orange (`--ui-orange`) only for the made-up mark. Nothing in the app is pure white. People are round initials on one of four soft colours their name picks (`PersonAvatar`); a sample person is their face. Stickers and name tags are hidden in the app except the logo.
- **Me (3 Nov 2026):** Ambar asked for the repeats on /me to go. The profile header has Edit my listing and Your card; under it, the one next step, flat, with the page's one blue button; then the About tab (Add more chats at its end), Posts, and Meetings. Meetings is one list, each row to its brief once ready or else to the meeting, marked "From Explore" when someone met you there, then the open invites. Settings is only the frame's gear. Edit profile, as Instagram's (Ambar: "i cant change mine own photo and profile dtails"): your picture with "Add a photo" or "Change photo" (it opens your photos or camera) and "Remove photo", then your name with "Save name", then, while you are in Explore, your line and the dating switch. The browser draws the photo as a 480px square JPEG before it is sent, which leaves behind any camera or location data; it shows wherever you show (your profile, Explore, posts, friends lists, the chat's column), served from `/api/photos/:id`, and anyone signed in who is shown its id can load it. <!-- plain-words: allow (his words, quoted) -->
- **The name (3 Nov 2026):** the app is Meety, as is everyone's AI (Ambar: "i think we name it meety... its just the domain will be heymeety.com or hello whatever"); "Meet First" was already an App Store app for meeting people. "Your Meety" is your AI and "on Meety" is the app; where the two would meet in one line ("Your personal AI on Meety"), the line drops the app's name. The logo is the two name tags and the word Meety. The prompts still say Meet First until their next versions, so a reply the model writes may too. <!-- plain-words: allow (his words, quoted) -->
- **Words (3 Nov 2026):** everyone's AI is their Meety (Ambar chose "Meety for everyone" over "other": "Ask Maya's Meety", "Your Meety meets theirs first"), never persona or agent in the app's words, and the plural is Meetys; Explore, never the directory; quote, never receipt; and a label carries no character count, since the refusal states the limit. Prompts and model tool text keep their own words, because changing them breaks the recorded replies, and three of the database's own refusals (romance_not_open, listing_not_found, directory_self) still say persona or the directory until a migration rewords them. Buttons say what happens (Ambar: "rename a few things... like wdym by meet button"): "See how you'd get on with Mira" opens the picker where your Meety and theirs talk a question through (it was "Meet Mira's Meety"), and the picker asks "What should your Meetys talk about?"; your own profile's button is "Edit profile" (was "Edit my listing"); a help search's button is "Find who could help" and its card says "Finding who could help"; a friend ask's card says "Asking Mira's Meety"; sent asks read "Asked a friend's Meety" and "Found who could help"; the home column's link to your profile is "View". <!-- plain-words: allow (his words, quoted) -->
- **No boxes (3 Nov 2026):** Ambar: "unnecessary curved boxes some places inside are showing ai slop". In the app a `.panel`, `.soft-panel` or `.colour-panel` is a section with space around it, and two sections meet at a hairline; only a dialog keeps a box. A quote is the words in quotation marks with the source under them, never a card. A box stays only where it groups one thing the person acts on: an input, the chat box, a suggested person's card in Explore, a sticky action bar. No card inside a card, no pill label on top of a box, no box round one line, an empty state or a list that already has hairlines. Kinds and statuses are grey words, never coloured pills, and nothing is green. The public pages (welcome, share, join, claim) keep the landing's look; every app override sits under `.social-frame`.
- **Kept rules:** curved corners on everything that stays a box (buttons 10px, tiles 14px, dialogs 20px, the chat box and chips pills), text 13px and up, no all caps, no em dashes, one main action per screen.

## The idea

The look comes from one thing in Meety's own world: the "Hello, my name is" sticker everyone wears on day one of a hackathon.

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
| Person | `<Avatar name side />`: the initial on a circle in the side's colour, on the landing and the public pages. In the app `<PersonAvatar name photo isSample />` shows a sample person's face with the orange mark. |
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
- Photos of real people we do not have, or a made-up face without the orange mark. Ambar chose no photos on 27 Oct; on 3 Nov he asked for faces on the sample people, each marked as made up.
- Inline `style` attributes in markup. Set custom properties from a class instead.
  - Two known exceptions remain. A test reads the comic panel grid's column count and the comic image width from inline style values. React sets these through the DOM, which the CSP allows. They can go once those tests read classes instead.
