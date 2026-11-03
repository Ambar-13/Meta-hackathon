// The photos of the sample people (3 Nov 2026): the face of each, and the photo of a post that has one. The api adds them to what it
// sends for a sample person, by display name and post text, as keys the web build maps to its bundled images. Real people have none yet.
import { SAMPLE_PEOPLE, type SamplePhoto } from "./sample-people.js";

// The key of a sample person's face by their display name; null for a name no sample person has.
// Example: "Maya" gives "faces/maya".
export function sampleFaceKey(displayName: string): string | null {
  return SAMPLE_PEOPLE.find((person) => person.displayName === displayName)?.face ?? null;
}

// The photo of a sample person's post, by their display name and the post's text; null when the post has no photo.
export function samplePostPhoto(displayName: string, text: string): SamplePhoto | null {
  const person = SAMPLE_PEOPLE.find((candidate) => candidate.displayName === displayName);
  return person?.posts.find((post) => post.text === text)?.photo ?? null;
}
