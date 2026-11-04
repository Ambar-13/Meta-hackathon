// The sample people's photos: free Unsplash photos picked for their posts, and a face for each of
// them, each marked as made up. They are bundled into the web build, so the app's own site serves
// them: its content security policy loads images from itself only. The api names a photo by its key
// (packages/db/src/samples/sample-photos.ts).
import { POST_PHOTO_SIDE, routes } from "@meet-first/contracts";
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

// A bundled photo: its address, and its size in pixels, so a post keeps its shape while the photo
// loads.
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

// The start of the key of a photo a person put up themselves, a profile photo or a post's, which
// the api serves by its id.
const UPLOADED_PREFIX = "photos/";

// A post's photo by its key: a bundled photo with its size, or a photo a person shared, served by
// the api and drawn square; null for no key, or for one this build does not have.
export function photoOf(key: string | null | undefined): BundledPhoto | null {
  if (key === null || key === undefined) return null;
  if (key.startsWith(UPLOADED_PREFIX))
    return { src: uploadedUrl(key), width: POST_PHOTO_SIDE, height: POST_PHOTO_SIDE };
  return PHOTOS[key] ?? null;
}

// The api address of a photo a person put up, by its key.
function uploadedUrl(key: string): string {
  return routes.people.readPhoto.path.replace(
    ":id",
    encodeURIComponent(key.slice(UPLOADED_PREFIX.length)),
  );
}

// The address of a photo by its key: a photo a person put up, from GET /api/photos/:id, or a
// bundled photo; null for no key, or for one this build does not have.
export function photoUrl(key: string | null | undefined): string | null {
  return photoOf(key)?.src ?? null;
}
