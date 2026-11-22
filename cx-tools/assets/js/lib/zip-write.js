// Writing ZIP archives with the platform's CompressionStream (deflate-raw).
// Used by "свали всички" in every tool that produces several files, so the user
// gets one download instead of twelve.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data && typeof data.arrayBuffer === 'function') return new Uint8Array(await data.arrayBuffer());
  throw new Error('Не мога да добавя този файл в архива.');
}

async function deflateRaw(bytes) {
  if (typeof CompressionStream !== 'function') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch (_err) {
    return null;
  }
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time =
    ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f);
  const day = (((year - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);
  return { time, day };
}

function uniqueName(name, used) {
  let candidate = name.replace(/^[/\\]+/, '') || 'file';
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  const dot = candidate.lastIndexOf('.');
  const stem = dot > 0 ? candidate.slice(0, dot) : candidate;
  const ext = dot > 0 ? candidate.slice(dot) : '';
  let i = 2;
  while (used.has(`${stem}-${i}${ext}`)) i += 1;
  const next = `${stem}-${i}${ext}`;
  used.add(next);
  return next;
}

/**
 * Build a ZIP (deflating each entry when that actually helps).
 * @param {Array<{name: string, data: Uint8Array|ArrayBuffer|Blob|string}>} files
 * @returns {Promise<Blob>}
 */
export async function createZip(files, options = {}) {
  const { onProgress } = options;
  const encoder = new TextEncoder();
  const { time, day } = dosDateTime();
  const parts = [];
  const central = [];
  const used = new Set();
  let offset = 0;

  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const name = uniqueName(file.name, used);
    const nameBytes = encoder.encode(name);
    const bytes = await toBytes(file.data);
    const checksum = crc32(bytes);

    let payload = bytes;
    let method = 0;
    if (bytes.length > 200) {
      const compressed = await deflateRaw(bytes);
      if (compressed && compressed.length < bytes.length - 32) {
        payload = compressed;
        method = 8;
      }
    }

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, method, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, day, true);
    lv.setUint32(14, checksum, true);
    lv.setUint32(18, payload.length, true);
    lv.setUint32(22, bytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    parts.push(local, payload);

    const entry = new Uint8Array(46 + nameBytes.length);
    const ev = new DataView(entry.buffer);
    ev.setUint32(0, 0x02014b50, true);
    ev.setUint16(4, 20, true);
    ev.setUint16(6, 20, true);
    ev.setUint16(8, 0x0800, true);
    ev.setUint16(10, method, true);
    ev.setUint16(12, time, true);
    ev.setUint16(14, day, true);
    ev.setUint32(16, checksum, true);
    ev.setUint32(20, payload.length, true);
    ev.setUint32(24, bytes.length, true);
    ev.setUint16(28, nameBytes.length, true);
    ev.setUint32(42, offset, true);
    entry.set(nameBytes, 46);
    central.push(entry);

    offset += local.length + payload.length;
    if (onProgress) onProgress(i + 1, files.length);
  }

  const centralSize = central.reduce((sum, e) => sum + e.length, 0);
  if (offset + centralSize > 0xffffffff) {
    throw new Error('Архивът стана над 4 GB. Свали файловете на части.');
  }

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
