// Accepting a photo, and showing it — in one place.
//
// Two things every photo tool here needs and neither browser gives for free:
//
// 1. Decoding whatever the phone produced. iPhone photos are HEIC, which no
//    browser draws in an <img>, so those go through the vendored wasm decoder.
// 2. A thumbnail the browser CAN draw. A blob URL of a HEIC file shows nothing
//    at all, which is why the tiles used to come up empty for HEIC photos; a
//    small JPEG made here shows the actual picture for every format, and keeps
//    a handful of large phone photos from being held decoded in the tab.

import { decodeImage } from './image.js';
import { looksLikeHeic, heicToCanvas } from './heic.js';

export function isImageish(file) {
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  return /\.(jpe?g|png|webp|heic|heif|gif|bmp|avif)$/i.test(file.name || '');
}

/** Decode any accepted photo into something drawable, EXIF orientation applied. */
export async function decodeAny(file) {
  if (await looksLikeHeic(file)) {
    const canvas = await heicToCanvas(file);
    return { source: canvas, width: canvas.width, height: canvas.height, close() {} };
  }
  return decodeImage(file);
}

/**
 * A small JPEG thumbnail of any accepted photo, as a blob URL for an <img src>.
 * The caller owns the URL and revokes it when the photo goes away.
 */
export async function makeThumb(file, maxEdge = 240) {
  const decoded = await decodeAny(file);
  try {
    if (!(decoded.width > 0 && decoded.height > 0)) throw new Error('празна снимка');
    const scale = Math.min(1, maxEdge / Math.max(decoded.width, decoded.height));
    const w = Math.max(1, Math.round(decoded.width * scale));
    const h = Math.max(1, Math.round(decoded.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(decoded.source, 0, 0, w, h);
    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.82);
    });
    canvas.width = 1;
    canvas.height = 1;
    if (!blob) throw new Error('миниатюрата не се получи');
    return URL.createObjectURL(blob);
  } finally {
    decoded.close();
  }
}

/**
 * Make thumbnails for these items one at a time (a phone should not have five
 * full-size photos decoded at once) and hand each finished one to `onReady`.
 * An item needs `file` and `thumbState`; it gets `thumbUrl` and a new
 * `thumbState` of 'ready' or 'failed', and is skipped when it was removed while
 * waiting.
 */
const queue = [];
let running = false;

export function fillThumbs(items, onReady) {
  for (const item of items) {
    if (item.thumbState !== 'pending') continue;
    item.thumbState = 'queued';
    queue.push({ item, onReady });
  }
  pump();
}

function pump() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  running = true;
  makeThumb(job.item.file)
    .then((url) => {
      if (job.item.removed) {
        URL.revokeObjectURL(url);
        return;
      }
      job.item.thumbUrl = url;
      job.item.thumbState = 'ready';
      job.onReady(job.item);
    })
    .catch(() => {
      job.item.thumbState = 'failed';
      job.onReady(job.item);
    })
    .finally(() => {
      running = false;
      pump();
    });
}
