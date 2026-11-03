// The sample people's photos (3 Nov 2026): free Unsplash photos picked for their posts, and a face for each of them, which Ambar asked
// for ("cute human avatars"), each marked as made up. They are bundled into the web build, so the app's own site serves them: its
// content security policy loads images from itself only. The api names a photo by its key (packages/db/src/samples/sample-photos.ts).
import faceJun from "./samples/faces/jun.jpg";
import faceLeila from "./samples/faces/leila.jpg";
import faceMaya from "./samples/faces/maya.jpg";
import facePriya from "./samples/faces/priya.jpg";
import faceRavi from "./samples/faces/ravi.jpg";
import faceTomas from "./samples/faces/tomas.jpg";
import junRobot from "./samples/jun-robot.jpg";
import junWorkbench from "./samples/jun-workbench.jpg";
import leilaLetters from "./samples/leila-letters.jpg";
import mayaMorning from "./samples/maya-morning.jpg";
import priyaPhone from "./samples/priya-phone.jpg";
import priyaSketches from "./samples/priya-sketches.jpg";
import raviWhiteboard from "./samples/ravi-whiteboard.jpg";
import tomasCharts from "./samples/tomas-charts.jpg";

// A bundled photo: its address, and its size in pixels, so a post keeps its shape while the photo loads.
export type BundledPhoto = { src: string; width: number; height: number };

// Every bundled photo by its key.
const PHOTOS: Readonly<Record<string, BundledPhoto>> = {
  "faces/jun": { src: faceJun, width: 320, height: 320 },
  "faces/leila": { src: faceLeila, width: 320, height: 320 },
  "faces/maya": { src: faceMaya, width: 320, height: 320 },
  "faces/priya": { src: facePriya, width: 320, height: 320 },
  "faces/ravi": { src: faceRavi, width: 320, height: 320 },
  "faces/tomas": { src: faceTomas, width: 320, height: 320 },
  "jun-robot": { src: junRobot, width: 1080, height: 608 },
  "jun-workbench": { src: junWorkbench, width: 1080, height: 720 },
  "leila-letters": { src: leilaLetters, width: 1080, height: 721 },
  "maya-morning": { src: mayaMorning, width: 1080, height: 1620 },
  "priya-phone": { src: priyaPhone, width: 1080, height: 1620 },
  "priya-sketches": { src: priyaSketches, width: 1080, height: 720 },
  "ravi-whiteboard": { src: raviWhiteboard, width: 1080, height: 720 },
  "tomas-charts": { src: tomasCharts, width: 1080, height: 720 },
};

// A bundled photo by its key; null for no key, or for one this build does not have.
export function photoOf(key: string | null | undefined): BundledPhoto | null {
  if (key === null || key === undefined) return null;
  return PHOTOS[key] ?? null;
}

// The address of a bundled photo by its key; null for no key, or for one this build does not have.
export function photoUrl(key: string | null | undefined): string | null {
  return photoOf(key)?.src ?? null;
}
