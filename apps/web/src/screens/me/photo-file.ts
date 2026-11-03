// A picture file drawn as the square JPEG a profile photo is (3 Nov 2026): the middle square of the picture, PHOTO_SIDE pixels a side.
// Drawing it in the browser keeps the upload small and leaves behind whatever the file carried besides the picture, such as where and
// with what camera it was taken.

// The side of a profile photo in pixels: sharp on the largest round picture the app draws (150 px) on a screen of three times its pixels.
const PHOTO_SIDE = 480;
// The JPEG quality the photo is drawn at.
const PHOTO_QUALITY = 0.86;

// The error for a file the browser cannot draw: not a picture, or one it cannot read.
export class PhotoFileError extends Error {}

// The middle square of a picture file as a JPEG of PHOTO_SIDE pixels a side; throws PhotoFileError when the file is not a picture this
// browser can draw. The browser turns a photo the right way up from its camera data as it reads it.
export async function squareJpeg(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new PhotoFileError("not a picture");
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = PHOTO_SIDE;
  canvas.height = PHOTO_SIDE;
  const context = canvas.getContext("2d");
  if (context === null || side === 0) throw new PhotoFileError("no canvas");
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, PHOTO_SIDE, PHOTO_SIDE);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new PhotoFileError("no jpeg"));
      else resolve(blob);
    }, "image/jpeg", PHOTO_QUALITY);
  });
}
