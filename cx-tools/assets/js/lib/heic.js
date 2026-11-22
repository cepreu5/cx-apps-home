// HEIC/HEIF decoding, loaded only when someone actually converts an iPhone
// photo: the decoder is ~1.5 MB of wasm and most visitors never need it.
//
// The wasm binary is a local file in vendor/ — it is fetched from our own
// origin (and cached by the service worker), never from a CDN.

import { canvasToBlob } from './util.js';

const LIB_URL = new URL('../../../vendor/libheif/libheif.js', import.meta.url).href;
const WASM_URL = new URL('../../../vendor/libheif/libheif.wasm', import.meta.url).href;

let libPromise = null;

function loadClassicScript(url) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-vendor="libheif"]`);
    if (existing) {
      if (existing.dataset.loaded === 'yes') return resolve();
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('HEIC декодерът не се зареди.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.dataset.vendor = 'libheif';
    script.onload = () => {
      script.dataset.loaded = 'yes';
      resolve();
    };
    script.onerror = () => reject(new Error('HEIC декодерът не се зареди. Провери връзката за първото отваряне.'));
    document.head.append(script);
  });
}

/** The decoder module, initialised once per page. */
export function getHeicDecoder() {
  if (!libPromise) {
    libPromise = (async () => {
      await loadClassicScript(LIB_URL);
      const factory = window.libheif;
      if (typeof factory !== 'function') throw new Error('HEIC декодерът не се зареди правилно.');
      // This build starts the wasm synchronously, so the bytes have to be in
      // memory first: fetch them from vendor/ (one request, cached by the
      // service worker) and hand them over as wasmBinary.
      const response = await fetch(WASM_URL, { cache: 'force-cache' });
      if (!response.ok) throw new Error('HEIC декодерът не може да се свали (wasm файлът липсва).');
      const wasmBinary = new Uint8Array(await response.arrayBuffer());
      const options = {
        wasmBinary,
        locateFile: (file) => (file.endsWith('.wasm') ? WASM_URL : file),
      };
      let module = factory(options);
      if (module && typeof module.then === 'function') module = await module;
      if (module && module.ready && typeof module.ready.then === 'function') await module.ready;
      if (!module || typeof module.HeifDecoder !== 'function') {
        throw new Error('HEIC декодерът не се зареди правилно.');
      }
      return module;
    })().catch((err) => {
      libPromise = null;
      throw err;
    });
  }
  return libPromise;
}

/** Cheap sniff: extension, MIME, or the ISO-BMFF brand in the first bytes. */
export async function looksLikeHeic(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.heic') || name.endsWith('.heif')) return true;
  if ((file.type || '').toLowerCase().includes('hei')) return true;
  try {
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (head.length < 12) return false;
    const brand = String.fromCharCode(head[8], head[9], head[10], head[11]);
    return ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis'].includes(brand);
  } catch (_err) {
    return false;
  }
}

/**
 * Decode one HEIC/HEIF file into a canvas of raw pixels.
 * libheif applies the image's own rotation/mirror transforms while decoding,
 * so the pixels come out the right way up.
 */
export async function heicToCanvas(file) {
  const lib = await getHeicDecoder();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const decoder = new lib.HeifDecoder();
  const images = decoder.decode(bytes);
  if (!images || !images.length) {
    throw new Error('Във файла няма снимка, която да се преобразува.');
  }
  const image = images[0];
  const width = image.get_width();
  const height = image.get_height();
  if (!width || !height) throw new Error('Снимката е празна или повредена.');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  const imageData = ctx.createImageData(width, height);
  await new Promise((resolve, reject) => {
    image.display(imageData, (data) => {
      if (data) resolve(data);
      else reject(new Error('HEIC декодерът не успя да прочете тази снимка.'));
    });
  });
  ctx.putImageData(imageData, 0, 0);

  for (const img of images) {
    if (img && typeof img.free === 'function') img.free();
  }
  return canvas;
}

/** Decode one HEIC/HEIF file into a JPEG blob at the requested quality. */
export async function heicToJpeg(file, quality = 0.9) {
  const canvas = await heicToCanvas(file);
  const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
  const out = { blob, width: canvas.width, height: canvas.height };
  canvas.width = 1;
  canvas.height = 1;
  return out;
}
