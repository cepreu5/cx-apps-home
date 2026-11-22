// Reading ZIP archives with nothing but the platform: DecompressionStream.
// Handles stored (0) and deflated (8) entries, data descriptors (sizes are read
// from the central directory, which always has them) and ZIP64 size fields.

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;

export const ZIP_LIMITS = {
  maxEntries: 2000,
  maxTotalUncompressed: 600 * 1024 * 1024,
  maxSingleEntry: 300 * 1024 * 1024,
};

function toBytes(input) {
  if (input instanceof Uint8Array) return Promise.resolve(input);
  if (input instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(input));
  if (input && typeof input.arrayBuffer === 'function') {
    return input.arrayBuffer().then((buf) => new Uint8Array(buf));
  }
  return Promise.reject(new Error('Архивът не може да бъде прочетен.'));
}

function findEocd(view, bytes) {
  const min = Math.max(0, bytes.length - 0xffff - 22);
  for (let i = bytes.length - 22; i >= min; i -= 1) {
    if (view.getUint32(i, true) === SIG_EOCD) return i;
  }
  return -1;
}

const u16 = (view, at) => view.getUint16(at, true);
const u32 = (view, at) => view.getUint32(at, true);
const u64 = (view, at) => u32(view, at) + u32(view, at + 4) * 0x100000000;

const decoderStrict = new TextDecoder('utf-8', { fatal: false });
const decoderLatin = new TextDecoder('latin1');

function decodeName(bytes, start, length, flags) {
  const slice = bytes.subarray(start, start + length);
  if ((flags & 0x800) !== 0) return decoderStrict.decode(slice);
  // Legacy archives: cp437 is close enough to latin1 for the ASCII names that
  // practically all of them use, and latin1 never throws.
  return decoderLatin.decode(slice);
}

/**
 * Parse a ZIP archive's index.
 * @returns {Promise<{entries: Array, totalUncompressed: number, extract: Function, guard: Function}>}
 */
export async function readZip(input) {
  const bytes = await toBytes(input);
  if (bytes.length < 22) throw new Error('Файлът е твърде малък, за да е ZIP архив.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const eocd = findEocd(view, bytes);
  if (eocd < 0) throw new Error('Това не изглежда като ZIP архив (липсва индекс на архива).');

  let entryCount = u16(view, eocd + 10);
  let cdSize = u32(view, eocd + 12);
  let cdOffset = u32(view, eocd + 16);

  const zip64Needed = entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff;
  if (zip64Needed) {
    const locator = eocd - 20;
    if (locator >= 0 && u32(view, locator) === SIG_ZIP64_LOCATOR) {
      const z64 = u64(view, locator + 8);
      if (z64 > 0 && z64 + 56 <= bytes.length && u32(view, z64) === SIG_ZIP64_EOCD) {
        entryCount = u64(view, z64 + 32);
        cdSize = u64(view, z64 + 40);
        cdOffset = u64(view, z64 + 48);
      }
    }
  }

  if (cdOffset + cdSize > bytes.length) {
    throw new Error('Архивът изглежда повреден: индексът е извън файла.');
  }

  const entries = [];
  let p = cdOffset;
  for (let n = 0; n < entryCount && p + 46 <= bytes.length; n += 1) {
    if (u32(view, p) !== SIG_CENTRAL) break;
    const flags = u16(view, p + 8);
    const method = u16(view, p + 10);
    const crc = u32(view, p + 16);
    let compSize = u32(view, p + 20);
    let uncompSize = u32(view, p + 24);
    const nameLen = u16(view, p + 28);
    const extraLen = u16(view, p + 30);
    const commentLen = u16(view, p + 32);
    let localOffset = u32(view, p + 42);
    const name = decodeName(bytes, p + 46, nameLen, flags);

    // ZIP64 extended information: only the fields that overflowed are present.
    let extra = p + 46 + nameLen;
    const extraEnd = extra + extraLen;
    while (extra + 4 <= extraEnd) {
      const id = u16(view, extra);
      const size = u16(view, extra + 2);
      if (id === 0x0001) {
        let q = extra + 4;
        if (uncompSize === 0xffffffff && q + 8 <= extra + 4 + size) {
          uncompSize = u64(view, q);
          q += 8;
        }
        if (compSize === 0xffffffff && q + 8 <= extra + 4 + size) {
          compSize = u64(view, q);
          q += 8;
        }
        if (localOffset === 0xffffffff && q + 8 <= extra + 4 + size) {
          localOffset = u64(view, q);
          q += 8;
        }
      }
      extra += 4 + size;
    }

    const isDir = name.endsWith('/');
    if (!isDir) {
      entries.push({
        name,
        method,
        flags,
        crc32: crc,
        compSize,
        uncompSize,
        offset: localOffset,
        encrypted: (flags & 0x1) !== 0,
      });
    }
    p += 46 + nameLen + extraLen + commentLen;
  }

  const totalUncompressed = entries.reduce((sum, e) => sum + e.uncompSize, 0);

  async function extract(entry) {
    if (entry.encrypted) throw new Error(`„${entry.name}“ е защитен с парола. Такъв архив не се отваря тук.`);
    if (entry.offset + 30 > bytes.length || u32(view, entry.offset) !== SIG_LOCAL) {
      throw new Error(`„${entry.name}“ е повреден в архива.`);
    }
    const nameLen = u16(view, entry.offset + 26);
    const extraLen = u16(view, entry.offset + 28);
    const start = entry.offset + 30 + nameLen + extraLen;
    const end = start + entry.compSize;
    if (end > bytes.length) throw new Error(`„${entry.name}“ излиза извън архива (повреден файл).`);
    const raw = bytes.subarray(start, end);

    if (entry.method === 0) return raw.slice();
    if (entry.method !== 8) {
      throw new Error(`„${entry.name}“ използва неподдържана компресия (метод ${entry.method}).`);
    }
    if (typeof DecompressionStream !== 'function') {
      throw new Error('Този браузър не може да разопакова deflate. Опитай с актуален Chrome, Safari или Firefox.');
    }
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  }

  /** A cheap, honest warning instead of freezing the tab on a huge archive. */
  function guard() {
    const problems = [];
    if (entries.length > ZIP_LIMITS.maxEntries) {
      problems.push(`Архивът има ${entries.length} файла. Показваме първите ${ZIP_LIMITS.maxEntries}.`);
    }
    if (totalUncompressed > ZIP_LIMITS.maxTotalUncompressed) {
      problems.push(
        `Разопаковано архивът е ${(totalUncompressed / (1024 * 1024 * 1024)).toFixed(1)} GB. ` +
          'Отварянето на всичко наведнъж може да забие телефона — сваляй файловете един по един.',
      );
    }
    const huge = entries.filter((e) => e.uncompSize > ZIP_LIMITS.maxSingleEntry);
    if (huge.length) {
      problems.push(`${huge.length} файла са над ${Math.round(ZIP_LIMITS.maxSingleEntry / (1024 * 1024))} MB.`);
    }
    return { problems, safeToExtractAll: problems.length === 0 };
  }

  return {
    name: input && input.name ? input.name : 'архив.zip',
    size: bytes.length,
    entries: entries.slice(0, ZIP_LIMITS.maxEntries * 4),
    totalUncompressed,
    extract,
    guard,
  };
}
