// A picture file drawn as the JPEG the app sends: a profile photo as the middle square of the picture, PHOTO_SIDE pixels a
// side; a post's photo as the middle square, POST_PHOTO_SIDE pixels a side, as Instagram's square post; a story's photo as the whole
// picture, at most POST_PHOTO_SIDE wide and STORY_MAX_HEIGHT tall. Drawing it in the browser keeps the upload small and leaves behind
// whatever the file carried besides the picture, such as where and with what camera it was taken.
import { POST_PHOTO_MAX_BYTES, POST_PHOTO_SIDE } from "@meet-first/contracts";

// The side of a profile photo in pixels: sharp on the largest round picture the app draws (150 px) on a screen of three times its pixels.
const PHOTO_SIDE = 480;
// The JPEG quality the photo is drawn at.
const PHOTO_QUALITY = 0.86;
// The tallest a story's photo is drawn, in pixels: a phone screen at 9:16.
const STORY_MAX_HEIGHT = 1920;
// The JPEG qualities a post's or a story's photo is tried at, best first, until it fits POST_PHOTO_MAX_BYTES.
const SHARED_QUALITIES = [0.85, 0.72, 0.6] as const;

// The error for a file the browser cannot draw: not a picture, or one it cannot read.
export class PhotoFileError extends Error {}

// The part of the picture to draw and the size to draw it at.
type Frame = { sx: number; sy: number; sw: number; sh: number; width: number; height: number };

// Reads a picture file as a bitmap; throws PhotoFileError when the file is not a picture this browser can draw. The browser turns a
// photo the right way up from its camera data as it reads it.
async function readBitmap(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new PhotoFileError("not a picture");
  }
}

// Draws one frame of a bitmap on a new canvas; throws PhotoFileError when there is nothing to draw on or with.
function drawFrame(bitmap: ImageBitmap, frame: Frame): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const context = canvas.getContext("2d");
  if (context === null || frame.sw === 0 || frame.sh === 0) throw new PhotoFileError("no canvas");
  context.drawImage(bitmap, frame.sx, frame.sy, frame.sw, frame.sh, 0, 0, frame.width, frame.height);
  return canvas;
}

// The canvas as a JPEG at one quality.
function jpegOf(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new PhotoFileError("no jpeg"));
      else resolve(blob);
    }, "image/jpeg", quality);
  });
}

// The middle square of a bitmap, drawn side pixels a side.
function middleSquare(bitmap: ImageBitmap, side: number): Frame {
  const crop = Math.min(bitmap.width, bitmap.height);
  return { sx: (bitmap.width - crop) / 2, sy: (bitmap.height - crop) / 2, sw: crop, sh: crop, width: side, height: side };
}

// The middle square of a picture file as a JPEG of PHOTO_SIDE pixels a side, for a profile photo; throws PhotoFileError when the file
// is not a picture this browser can draw.
export async function squareJpeg(file: Blob): Promise<Blob> {
  const bitmap = await readBitmap(file);
  const canvas = drawFrame(bitmap, middleSquare(bitmap, PHOTO_SIDE));
  bitmap.close();
  return jpegOf(canvas, PHOTO_QUALITY);
}

// The canvas as a JPEG that fits POST_PHOTO_MAX_BYTES at the best quality of SHARED_QUALITIES; throws PhotoFileError when even the
// lowest is too large.
async function fittingJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  for (const quality of SHARED_QUALITIES) {
    const blob = await jpegOf(canvas, quality);
    if (blob.size <= POST_PHOTO_MAX_BYTES) return blob;
  }
  throw new PhotoFileError("too large");
}

// The middle square of a picture file as a JPEG of POST_PHOTO_SIDE pixels a side, for a post.
export async function postJpeg(file: Blob): Promise<Blob> {
  const bitmap = await readBitmap(file);
  const canvas = drawFrame(bitmap, middleSquare(bitmap, POST_PHOTO_SIDE));
  bitmap.close();
  return fittingJpeg(canvas);
}

// The whole of a picture file as a JPEG at most POST_PHOTO_SIDE wide and STORY_MAX_HEIGHT tall, never drawn larger than it is, for a
// story, which shows it whole on a blurred copy of itself.
export async function storyJpeg(file: Blob): Promise<Blob> {
  const bitmap = await readBitmap(file);
  const scale = Math.min(1, POST_PHOTO_SIDE / bitmap.width, STORY_MAX_HEIGHT / bitmap.height);
  const canvas = drawFrame(bitmap, { sx: 0, sy: 0, sw: bitmap.width, sh: bitmap.height, width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
  bitmap.close();
  return fittingJpeg(canvas);
}

// A JPEG as the base64 text POST /api/posts carries.
export async function base64Of(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = "";
  for (let start = 0; start < bytes.length; start += 0x8000) text += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  return btoa(text);
}
