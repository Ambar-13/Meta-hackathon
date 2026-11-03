# Sample photos

The six sample people have a face each, and eight of their posts have a photo. All fourteen are free photos from Unsplash under the
[Unsplash License](https://unsplash.com/license), which allows use without asking or crediting; they are credited here anyway. They were
downloaded on 3 Nov 2026 (posts 1080px wide, faces 320px square) and live in `apps/web/src/look/samples`, so the web build serves them
itself under its content security policy. The faces belong to real people photographed for Unsplash, not to the sample people: the app
puts an orange asterisk on every sample person's picture so nobody takes them for real.

The api names a photo by its key (`packages/db/src/samples/sample-people.ts`); the web build maps each key to its file
(`apps/web/src/look/sample-photos.ts`).

| Key | Unsplash photo |
|---|---|
| `faces/maya` | [photo-1592275772614-ec71b19e326f](https://images.unsplash.com/photo-1592275772614-ec71b19e326f) |
| `faces/priya` | [photo-1725033489648-a819750348eb](https://images.unsplash.com/photo-1725033489648-a819750348eb) |
| `faces/ravi` | [photo-1757744705465-ea08b0ddc38a](https://images.unsplash.com/photo-1757744705465-ea08b0ddc38a) |
| `faces/jun` | [photo-1769961982389-bb243681421a](https://images.unsplash.com/photo-1769961982389-bb243681421a) |
| `faces/leila` | [photo-1787095245569-00f583ccd06b](https://images.unsplash.com/photo-1787095245569-00f583ccd06b) |
| `faces/tomas` | [photo-1568602471122-7832951cc4c5](https://images.unsplash.com/photo-1568602471122-7832951cc4c5) |
| `maya-morning` | [photo-1543233604-3baca4d35513](https://images.unsplash.com/photo-1543233604-3baca4d35513) |
| `priya-sketches` | [photo-1581291518633-83b4ebd1d83e](https://images.unsplash.com/photo-1581291518633-83b4ebd1d83e) |
| `priya-phone` | [photo-1541560052-3744e48ab80b](https://images.unsplash.com/photo-1541560052-3744e48ab80b) |
| `ravi-whiteboard` | [photo-1590103514966-5e2a11c13e21](https://images.unsplash.com/photo-1590103514966-5e2a11c13e21) |
| `jun-workbench` | [photo-1555664424-778a1e5e1b48](https://images.unsplash.com/photo-1555664424-778a1e5e1b48) |
| `jun-robot` | [photo-1730361961626-b046f69b9df2](https://images.unsplash.com/photo-1730361961626-b046f69b9df2) |
| `leila-letters` | [photo-1637597384611-0c33cef6ec03](https://images.unsplash.com/photo-1637597384611-0c33cef6ec03) |
| `tomas-charts` | [photo-1551288049-bebda4e38f71](https://images.unsplash.com/photo-1551288049-bebda4e38f71) |

To add a photo: put the file in `apps/web/src/look/samples` under its key, add the key with its size to `PHOTOS` in
`apps/web/src/look/sample-photos.ts`, and give the post its `photo` with the words for it in `sample-people.ts`. The unit test W7-PHOTO-T6
fails when a key has no file.
