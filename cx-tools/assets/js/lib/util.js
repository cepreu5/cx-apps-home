// Small helpers shared by every tool. No dependencies, no network.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Build an element: h('div', { class: 'row' }, 'text', childNode) */
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1000) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export function totalSize(items) {
  return items.reduce((sum, f) => sum + (f.size || 0), 0);
}

export function baseName(name = '') {
  const clean = name.split(/[\\/]/).pop() || 'file';
  const dot = clean.lastIndexOf('.');
  return dot > 0 ? clean.slice(0, dot) : clean;
}

export function extOf(name = '') {
  const clean = name.split(/[\\/]/).pop() || '';
  const dot = clean.lastIndexOf('.');
  return dot > 0 ? clean.slice(dot + 1).toLowerCase() : '';
}

export function isHeicName(name = '') {
  const ext = extOf(name);
  return ext === 'heic' || ext === 'heif';
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.9) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Браузърът не успя да създаде файл от тази снимка.'));
    }, type, quality);
  });
}

/** Let the browser paint between heavy steps, so progress is visible. */
export function yieldToUI() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** "1-3,7,10-12" -> [[1,3],[7,7],[10,12]] ; throws a Bulgarian message. */
export function parseRanges(text, pageCount) {
  const source = String(text || '').trim();
  if (!source) throw new Error('Напиши кои страници да се извадят, например 1-3,7.');
  const parts = source.split(/[,;\s]+/).filter(Boolean);
  const ranges = [];
  for (const part of parts) {
    const m = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (m) {
      let a = Number(m[1]);
      let b = Number(m[2]);
      if (a > b) [a, b] = [b, a];
      if (a < 1 || b > pageCount) throw new Error(`Диапазонът „${part}“ е извън документа (1–${pageCount}).`);
      ranges.push([a, b]);
      continue;
    }
    if (/^\d+$/.test(part)) {
      const p = Number(part);
      if (p < 1 || p > pageCount) throw new Error(`Страница ${p} не съществува (1–${pageCount}).`);
      ranges.push([p, p]);
      continue;
    }
    throw new Error(`Не разбрах „${part}“. Използвай вида 1-3,7,10-12.`);
  }
  if (!ranges.length) throw new Error('Напиши кои страници да се извадят, например 1-3,7.');
  return ranges;
}

export function pagesFromRanges(ranges) {
  const pages = [];
  for (const [a, b] of ranges) for (let p = a; p <= b; p += 1) pages.push(p);
  return pages;
}

export function countLabel(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

export function setProgress(root, ratio, label) {
  const bar = typeof root === 'string' ? document.querySelector(root) : root;
  if (!bar) return;
  bar.style.setProperty('--v', String(Math.max(0, Math.min(1, ratio))));
  if (label) bar.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
}

export function bytesToMbText(bytes) {
  return formatBytes(bytes);
}

/** Files picked from an <input> or dropped, filtered and de-duplicated by name+size. */
export function filesFromInput(input) {
  return Array.from(input.files || []);
}

export function pct(before, after) {
  if (!before) return 0;
  return Math.round((1 - after / before) * 100);
}
