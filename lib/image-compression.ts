"use client";

/**
 * Downscales and re-encodes an image in the browser before it is stored.
 *
 * Photos taken on a phone are routinely 3–5 MB, which the previous uploader
 * simply rejected. Resizing to a sensible edge length and stepping the JPEG
 * quality down until the result fits keeps a dish photo around 100–200 KB
 * while still looking good on a retina screen.
 */

export const MAX_IMAGE_EDGE = 1200;
export const TARGET_IMAGE_BYTES = 220 * 1024;
/** Hard ceiling; a save carrying several of these still fits in one request. */
export const MAX_STORED_IMAGE_BYTES = 700 * 1024;

export class ImageCompressionError extends Error {}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImageCompressionError("That file could not be read as an image."));
    };

    image.src = url;
  });
}

function scaleToFit(width: number, height: number, maxEdge: number) {
  const longestEdge = Math.max(width, height);
  if (longestEdge <= maxEdge) {
    return { width, height };
  }

  const ratio = maxEdge / longestEdge;
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}

export async function compressImageFile(
  file: File,
  { maxEdge = MAX_IMAGE_EDGE, targetBytes = TARGET_IMAGE_BYTES } = {},
): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new ImageCompressionError("Please choose an image file.");
  }

  // SVGs are vector and usually tiny; rasterising one would only make it
  // worse, so it is stored as-is.
  if (file.type === "image/svg+xml") {
    const text = await file.text();
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`;
  }

  const image = await loadImage(file);
  const { width, height } = scaleToFit(image.naturalWidth, image.naturalHeight, maxEdge);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new ImageCompressionError("This browser cannot process images.");
  }

  // White backing so transparent PNGs do not turn black once encoded as JPEG.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  let result = "";
  for (const quality of [0.82, 0.72, 0.62, 0.5, 0.4]) {
    result = canvas.toDataURL("image/jpeg", quality);
    // A base64 string is roughly 4/3 the size of the bytes it encodes.
    if (result.length * 0.75 <= targetBytes) {
      break;
    }
  }

  if (result.length * 0.75 > MAX_STORED_IMAGE_BYTES) {
    throw new ImageCompressionError("That image is too detailed to store. Please try a smaller one.");
  }

  return result;
}
