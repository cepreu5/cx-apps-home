// Image decoding + local JPEG compression. Everything here runs in the tab;
// nothing is uploaded, and the only network use ever is fetching a vendored
// library the first time a tool needs it.

import { canvasToBlob } from './util.js';

/**
 * Decode a file into something drawable. The decoder applies EXIF orientation
 * for us (imageOrientation: 'from-image'), so a portrait phone photo stays
 * portrait instead of arriving on its side.
 */
export async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close() {
          bitmap.close();
        },
      };
    } catch (_err) {
      /* older browsers / odd formats: fall back to an <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.decoding = 'async';
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('Този файл не се отваря като снимка в браузъра.'));
      im.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      close() {
        URL.revokeObjectURL(url);
      },
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

export function canvasFor(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

/** Draw a decoded image scaled so its longer edge is at most `longEdge`. */
export function drawWithin(decoded, longEdge) {
  const scale = Math.min(1, longEdge / Math.max(decoded.width, decoded.height));
  const width = Math.max(1, Math.round(decoded.width * scale));
  const height = Math.max(1, Math.round(decoded.height * scale));
  const { canvas, ctx } = canvasFor(width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(decoded.source, 0, 0, width, height);
  return canvas;
}

const QUALITY_LADDER = [0.92, 0.86, 0.8, 0.74, 0.66, 0.58, 0.5, 0.42];

/**
 * Compress one image towards a byte budget: first by lowering JPEG quality,
 * then, if that is not enough, by lowering the pixel dimensions. With no budget
 * ("само намали размера") it just caps the long edge once at high quality.
 */
export async function compressImage(decoded, options = {}) {
  const { targetBytes = null, maxLongEdge = null, quality = 0.88, floorLongEdge = 480, onAttempt } = options;
  const natural = Math.max(decoded.width, decoded.height);
  let longEdge = Math.min(maxLongEdge || natural, natural);
  let best = null;

  for (let round = 0; round < 7; round += 1) {
    const canvas = drawWithin(decoded, longEdge);
    if (!targetBytes) {
      const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
      return { blob, width: canvas.width, height: canvas.height, quality };
    }
    for (const q of QUALITY_LADDER) {
      const blob = await canvasToBlob(canvas, 'image/jpeg', q);
      best = { blob, width: canvas.width, height: canvas.height, quality: q };
      if (onAttempt) onAttempt(best);
      if (blob.size <= targetBytes) return best;
    }
    if (longEdge <= floorLongEdge) break;
    longEdge = Math.max(floorLongEdge, Math.round(longEdge * 0.8));
  }
  return best;
}

/** A small square-ish preview as a blob URL, used for result rows. */
export async function smallPreview(decoded, size = 96) {
  const canvas = drawWithin(decoded, size);
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.7);
  return URL.createObjectURL(blob);
}

export function filePreviewUrl(file) {
  return URL.createObjectURL(file);
}

/** Guess whether a dropped/picked file is an image we can decode directly. */
export function looksLikeImage(file) {
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  return /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name || '');
}
