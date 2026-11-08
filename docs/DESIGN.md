# Design

The look of the Meety web app. Who it is for and why it looks this way are in [PRODUCT.md](PRODUCT.md).

## The welcome page: the product before the mechanism

The first three seconds explain the social network in ordinary words: “People are more than profiles.” A fictional Jun example beside it on a laptop, and above the headline on a phone, shows the real interaction, a person, a question for their Meety, a qualified answer, and the source that supports it. The page says what someone can ask about (what a person may care about, want, dislike, or debate) before it asks the visitor to understand agents, personas, or two AIs meeting.

The public page borrows the signed-in product's restraint: the same near-white ground, Hanken and Bricolage, photo-led people, hairlines and compact social controls. The old sky, clouds, giant name-tag form, stacked question catalogue and decorative first-coffee interlude are gone. The deep coral-red from the left half of the Meety logo is the public brand anchor: it carries the words "with context", the primary action and the account-creation room. Colour still has a job: blue is direct questions and conversation, coral is the Meety brand and human reaction, yellow is curiosity and evidence, lilac is disagreement, and sage is possible collaboration. The flow is short: promise and product demo, questions a person could ask, three steps, control and privacy, account creation, then sign-in.

## The signed-in app: Instagram and Facebook

The signed-in app uses Instagram's photo-led feed and direct-message layout, with Facebook-style labelled navigation and clear blue actions. Colour supports the people, content and controls. Everything below this section is the landing's look; it stays for the welcome, claim, join and public share pages. Every signed-in page takes the look in `apps/web/src/app-shell/app-look.css`, scoped to `.social-frame`.

- **Pages, as Instagram's:** the feed is the default page, with no tabs on it; a search finds people to send friend requests to; the logo sits in the middle of the phone's top bar. The pages are Home (`/home`, the feed and the signed-in start), Search (`/search`: the search box, which finds people by the start of their name first and then by the words of their line and public items, the people as rows with Add friend, six suggested with See everyone, and the photos under "Explore" as Instagram's grid), Meety (`/meety`, the chat), Friends, Create (`/create`) and Me, in that order; `/explore` and `/directory` lead to Search. On a phone the top bar is Instagram's: Create (a plus in a square) at the left, the logo in the middle, Settings at the right, and the bottom bar keeps its five labelled icons, since Create lives in the top bar there.
- **Frame:** at 1200px and wider a 248px sidebar: the name-tag mark and "Meety" in Bricolage, the tagline "Your Meety meets theirs first.", the pages with icon and words (the current one on the soft fill, the request count at the row's end), a blue "Invite a friend" pill, Settings at the foot, and "Your Meety · Shares only what you choose" under a hairline. From 768px to 1200px the narrow Instagram rail of icons, each icon's words on hover. On a phone a top bar with the logo and Settings, a fixed, full-width bottom bar with five icons, each with its word under it at 13px, a blue selected icon, and a small red request badge. The bar respects the device's safe area.
- **Meety, the chat (an Instagram direct chat):** your friends as story circles across the top, a warm orange, pink and violet ring when their Meety can be asked; then the chat, as Instagram opens a chat with someone: a compact sticky header with a 44px Meety logo beside its name and "Your personal AI". The thread: a small grey time line ("Today 2:41 PM", "Yesterday", the weekday, then the date) at the top and wherever the chat paused 30 minutes; your messages in blue-to-violet bubbles on the right; Meety's in pale lilac bubbles from the left edge, its 28px logo in line with "Meety" over each run of its messages; a run sits 2px apart with its joined corners tucked to 6px, as Instagram groups messages, and runs sit 16px apart. What Meety plans, and what friends' Meetys answer, sit in a card with a hairline under its words, as Instagram shows a shared post: the kind's icon on a round patch of its colour (a magnifier on yellow for "Finding who could help", a speech bubble on coral for "Asking Mira's Meety"), the question in quotation marks, the consent line and one full-width blue button, or the answers with a hairline between them and "See all the answers". An empty chat opens with Meety's greeting (your name in coral) and the examples as quick replies stacked under it, rounded quick replies in peach, lilac and pale blue with their kind's icon patch. The box is a filled pill at the foot with a round blue Send arrow, grey until there is something to send. Tints are mixed toward the ground in OKLab, never OKLCH, whose hue path turns blue into green; on screens 1160px and wider a right-hand column with you (View), your friends with Ask, and people Explore suggests with Add friend.
- **Explore, profiles, Friends, Me (Instagram):** Explore is a feed (below); profiles with a round picture (150px laptop, 86px phone), the name, the count, the line, blue and grey buttons, and a hairline tab strip; requests and friends as plain rows. Friends has Invite a friend beside its title, a soft button with the person-plus icon, since a phone has no other way to it; from 1200px it steps aside for the sidebar's own. No row, card or profile says whether someone is open to dating questions; that switch only decides which questions reach their Meety.
- **Home, the feed:** Instagram's app on a phone, and the "Other" concept's measures on a laptop: a short grey line over the title "Home" (26px, weight 500, -0.045em) with today's date at the right, which a phone leaves out as Instagram does; your next step while your card is not approved; the row of stories (below); then the posts, with no tabs. The feed is endless and honest: your friends' posts and your own come first, newest first, ten at a time, the next page loading as you near the end (Show more posts does it by hand); when they run out, "You're all caught up" with a check in a pink ring and "You've seen every post from your friends.", as Instagram's, then everyone else's posts under Suggested posts; with no posts by friends, the feed goes straight to Suggested posts and says your friends' posts show there first, with Find friends in Search. At the end it says "That's every post for now." with Find people in Search, and it never fills itself with anything else. A post has a header (the 44px picture, the name, "· 2 hours ago", the line in grey, Add friend in blue words at the end, nothing for a friend); its photo immediately below the author, then actions and a 15px caption led by the author's name. With no photo, its words are large (24px, weight 500) on pale lilac; the soft strip "From what NAME shared" with their own words when one of their public items shares a word with the post; and Ask NAME's Meety (the chat with a friend ask when their Meety can be asked, else one line under the post saying why); the name and picture above already open the profile, so there is no Posts button. The photos, as Instagram's Explore grid (every photo post as a 3:4 tile with square corners, three to a row, 3px apart, each opening its writer's Posts tab), are on Search. On a phone the photos, the faces and the grid run to the screen's edges, and "Suggested for you" cards sit after the second post. At 1200px and wider a 264px right-hand column: the peach card "You're more than your posts." with three thin circles turning slowly in its corner and "See what it shares" (Me) in a pill, then "People you might click with" (up to four people who are not friends yet, each with Add friend) with See everyone, which opens Search, as See all does on the phone's cards. Left out of the concept: capitals, type under 13px, made-up counts of likes and comments, green, and photo captions it made up.
- **Posts, photos and sample people:** photos have square corners where every other surface is round: a wide photo at 3:2, a tall one at 4:5 on a phone and square on wider screens. A profile's Posts tab opens as Instagram's profile grid (3:4 tiles, three to a row, 3px apart, a post of words as its words on the warm card) when any post has a photo, with a Grid and List switch; a tile opens its post in the list. Posts of words alone are the list. Sample people have faces: free Unsplash portraits (credits in `docs/sample-photos.md`), each with a small orange asterisk at the top right of the picture, so nobody takes a made-up face for a real one; a post says "Sample person" to screen readers, and a card, a row and a profile keep the Sample word, the profile saying under the line that they are not a real person. Real people show the photo they put up in Edit profile, or else their initials.
- **Posts, stories and likes by everyone,** as on Instagram. Create (`/create`, the + of the phone's top bar and of the laptop's rail) has Instagram's two choices, Post and Story, as a pill switch; then the place to choose a photo, the size of what it becomes, which also says "Or share words alone."; the words; while you are not in Explore, "Only you see your posts until you join Explore."; then Share, full width and the page's one blue. The browser draws a post's photo as a 1080px square and a story's as the whole picture at most 1080px wide, both as JPEGs, which leaves behind any camera or location data. A story shows for 24 hours. Home's row of faces is Instagram's stories row: Your story first (your picture, a dashed ring and a blue plus, opening Create on Story; once you have a story it opens your stories), then each person with a story, new ones first, friends first, real before sample people, a warm gradient ring while one is new to you and a hairline once watched (the browser remembers what you watched). Sample people's story is their newest photo post. A story opens in a viewer over the whole page on a phone and as a 9:16 card on a dark ground on a laptop: a bar per story, the face, name and age ("Sample person" for a sample's), Pause or Play and Close as icons; the whole photo on a blurred, darkened copy of itself with the words over a soft shade at its foot, or words alone large on the warm card; Previous on the left third, Next on the rest, the arrow keys, and Escape; each story moves on after 5 seconds unless paused or the person asks their system for less motion; at the foot See profile, or on your own Delete story and Add to your story. Every post has Like first under it, the heart alone, filled red once liked, as Instagram's; nobody sees a count or a list of who liked it. Your own post has no Add friend or Ask, and Delete asks once more before it deletes. A post's photo with no words shows alone. On Me, Posts lists your own posts with New post and Delete, whether or not you are in Explore; an empty Posts tab says "Share your first post" on yours and "No posts yet" on someone else's.
- **Continue with Google:** when the site has a Google client, the start page shows Continue with Google above the name tag form: a light pill with Google's own G in its own colours (Google's guidelines do not let it be recoloured, so it is the one place green shows), then "or start with only your name" leading to the form. A sign-in that comes back unfinished says "Google sign-in did not finish. Try again." or "Google sign-in was cancelled. Try again whenever you like." over the button. Meety asks Google for the name only, never the email. /privacy, /terms and /cookies, linked from the welcome page's footer and from Google's sign-in screen, say in plain words what Meety keeps, the terms of using it, and what it keeps in the browser. There is no cookie banner: the only cookies are the two that sign you in.
- **Tokens:** Hanken Grotesk (the landing's own sans) with page titles large and light (36px, weight 500, -0.03em; 30px on a phone), an off-white ground (`--ui-bg`, #fffffe = oklch(99.9% 0.0008 78.3), also the public pages' `--paper`; at that lightness sRGB holds a chroma of 0.0008 at most), warm near-black ink, one warm grey (`--ui-ink-2`, 5.9:1 on the ground), hairlines (`--ui-line`) and soft fills (`--ui-soft`) at the ground's hue and a low chroma, so they read grey, not beige, Instagram's blue for main buttons (`--ui-blue`, its text in `--ui-bg`), red only for counts, deleting and a liked heart, the "Other" concept's warm card (`--ui-sand`, after its #eee9df) for text-only stories and a post of words in a profile's grid, orange (`--ui-orange`) for the made-up mark, peach for the Meety introduction and the card on what your Meety does, lilac for incoming messages and contextual quotes, and pale blue for selected and secondary controls. Story rings use `--ui-story`; outgoing messages use `--ui-message`. Nothing in the app is pure white. People are round initials on one of four soft colours their name picks (`PersonAvatar`); a sample person is their face. Stickers and name tags are hidden in the app except the logo.
- **Me:** nothing on /me repeats. The profile header has Edit profile and Your card; under it, the one next step, flat, with the page's one blue button; then the About tab (Add more chats at its end), Posts, and Meetings. Meetings is one list, each row to its brief once ready or else to the meeting, marked "From Explore" when someone met you there, then the open invites. Settings is only the frame's gear. Edit profile, as Instagram's: your picture with "Add a photo" or "Change photo" (it opens your photos or camera) and "Remove photo", then your name with "Save name", then, while you are in Explore, your line and the dating switch. The browser draws the photo as a 480px square JPEG before it is sent, which leaves behind any camera or location data; it shows wherever you show (your profile, Explore, posts, friends lists, the chat's column), served from `/api/photos/:id`, and anyone signed in who is shown its id can load it.
- **The name:** the app is Meety, as is everyone's AI; "Meet First" was already an App Store app for meeting people. "Your Meety" is your AI and "on Meety" is the app; where the two would meet in one line ("Your personal AI on Meety"), the line drops the app's name. The logo is the two name tags and the word Meety. The prompts still say Meet First until their next versions, so a reply the model writes may too.
- **Your AI's summary and Try your Meety:** on the upload page the summary comes first, then the chats: Copy the prompt, the paste box, the points it read with Remove on each, the "Friends' asks can use my summary" switch (off), and Save; once checked, "n of m points found in your chats". On Me, under the About items: Try your Meety (once there is a card or a summary), then the summary: its saved points, or while there are none one link, "Add your AI's summary", to the upload page that holds the form; and "With your chats, your Meety can quote you." while there are no chats. A Meety answers in four tiers: a quote from your own messages, said as firmly as you said it; a summary point never found in your chats, said as likely; a guess from who you are, close or rough, marked as a guess, with the quote it rests on; or "has not said", for sensitive topics, plain facts and what your quiz showed was a wrong guess.
- **Words:** everyone's AI is their Meety, never persona or agent in the app's words, and the plural is Meetys; Explore, never the directory; quote, never receipt; and a label carries no character count, since the refusal states the limit. Prompts and model tool text keep their own words, because changing them breaks the recorded replies, and three of the database's own refusals (romance_not_open, listing_not_found, directory_self) still say persona or the directory until a migration rewords them. Buttons say what happens: "See how you'd get on with Mira" opens the picker where your Meety and theirs talk a question through, and the picker asks "What should your Meetys talk about?"; your own profile's button is "Edit profile"; a help search's button is "Find who could help" and its card says "Finding who could help"; a friend ask's card says "Asking Mira's Meety"; sent asks read "Asked a friend's Meety" and "Found who could help"; the home column's link to your profile is "View".
- **No boxes:** in the app a `.panel`, `.soft-panel` or `.colour-panel` is a section with space around it, and two sections meet at a hairline; only a dialog keeps a box. A quote is the words in quotation marks with the source under them, never a card. A box stays only where it groups one thing the person acts on: an input, the chat box, a suggested person's card in Explore, a sticky action bar. No card inside a card, no pill label on top of a box, no box round one line, an empty state or a list that already has hairlines. Kinds and statuses are grey words, never coloured pills, and nothing is green. The public pages (welcome, share, join, claim) keep the landing's look; every app override sits under `.social-frame`.
- **Icons in place of words:** only where everyone reads the icon at once, whatever their age: the heart for Like, play and pause in a story, and a cross for Close (in a quote sheet's top right corner) and for removing a summary point. Every other control keeps its word, the tab bar keeps its labels, and every icon keeps its word for screen readers.
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

The colour strategy is a full palette. Tokens live in `apps/web/src/app-shell/app.css` for the public pages; signed-in colour tokens live in `app-shell/app-look.css`.

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
- Photos of real people we do not have, or a made-up face without the orange mark. The sample people's faces are the one exception, each marked as made up.
- Inline `style` attributes in markup. Set custom properties from a class instead.
 - Two known exceptions remain. A test reads the comic panel grid's column count and the comic image width from inline style values. React sets these through the DOM, which the CSP allows. They can go once those tests read classes instead.
