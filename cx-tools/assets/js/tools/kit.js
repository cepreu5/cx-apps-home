// Building blocks the five tools share: panels, the drop zone, progress lists
// and the "свали всички" ZIP button.

import { h, formatBytes, downloadBlob } from '../lib/util.js';
import { createZip } from '../lib/zip-write.js';
import { wireFiles, announce } from '../shell.js';

const ICON_UPLOAD =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4"/><path d="M7.5 8.5L12 4l4.5 4.5"/><path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16"/></svg>';

const ICON_CHECK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>';

export function panel(...children) {
  return h('div', { class: 'panel' }, ...children);
}

export function note(text, tone = 'good') {
  return h(
    'div',
    { class: `note ${tone}` },
    h('span', { class: 'noteicon', html: ICON_CHECK, 'aria-hidden': 'true' }),
    h('span', {}, text),
  );
}

export function stepLine(current, total, text) {
  return h(
    'div',
    { class: 'steps' },
    h('b', {}, `стъпка ${current} от ${total}`),
    h('span', { class: 'muted' }, text || ''),
  );
}

/**
 * A dashed drop area that accepts clicks, keyboard and drag & drop.
 * Returns { zone, input } so a caller can reset it or open the picker.
 */
export function dropZone({ title, hint, accept = '', multiple = true, onFiles, filter }) {
  const input = h('input', {
    type: 'file',
    class: 'sr-only',
    accept,
    multiple: multiple ? true : null,
    'aria-label': title,
  });
  const zone = h(
    'label',
    { class: 'drop' },
    h('span', { class: 'dropicon', html: ICON_UPLOAD, 'aria-hidden': 'true' }),
    h('strong', {}, title),
    h('span', {}, hint || ''),
    input,
  );
  wireFiles(zone, input, onFiles, { accept: filter });
  return { zone, input };
}

/** A progress bar + a line of status text, announced politely. */
export function progressBlock(label) {
  const bar = h('div', {
    class: 'prog',
    role: 'progressbar',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    'aria-valuenow': '0',
    'aria-label': label || 'Напредък',
  }, h('i'));
  const status = h('p', { class: 'small muted', style: 'margin:0 0 6px' }, label || '');
  const rows = h('div', { class: 'rows roll' });
  const wrap = h('div', {}, status, bar, rows);
  return {
    root: wrap,
    status,
    rows,
    set(ratio, text) {
      bar.style.setProperty('--v', String(Math.max(0, Math.min(1, ratio))));
      bar.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
      if (text) {
        status.textContent = text;
        announce(text);
      }
    },
    row(name) {
      const state = h('span', { class: 'state busy' }, 'чака');
      const meta = h('span', { class: 'meta' }, '');
      const row = h('div', { class: 'row' }, h('span', { class: 'name', title: name }, name), meta, state);
      rows.append(row);
      if (rows.children.length > 60) row.scrollIntoView({ block: 'nearest' });
      return {
        setState(text, tone = '') {
          state.textContent = text;
          state.className = `state ${tone}`;
        },
        setMeta(text) {
          meta.textContent = text;
        },
      };
    },
  };
}

/** Per-file result list with a download button on every row. */
export function resultRows(items) {
  const rows = h('div', { class: 'rows' });
  for (const item of items) {
    const btn = h(
      'button',
      { type: 'button', class: 'small', 'aria-label': `Свали ${item.name}` },
      'свали',
    );
    btn.addEventListener('click', () => downloadBlob(item.blob, item.name));
    rows.append(
      h(
        'div',
        { class: 'row' },
        h('span', { class: 'name', title: item.name }, item.name),
        h('span', { class: 'meta' }, item.meta || formatBytes(item.blob.size)),
        h('span', { class: 'acts' }, btn),
      ),
    );
  }
  return rows;
}

/**
 * "Свали всички (X MB)" — zips the results locally and downloads one file.
 * Falls back to downloading them one by one if the browser cannot zip.
 */
export function downloadAllButton(items, { zipName, lead = 'Свали всички', className = 'btn' } = {}) {
  const total = items.reduce((sum, i) => sum + i.blob.size, 0);
  const label = `${lead} (${formatBytes(total)})`;
  const btn = h('button', { type: 'button', class: className }, label);
  btn.addEventListener('click', async () => {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Сгъвам архива…';
    try {
      const blob = await createZip(items.map((i) => ({ name: i.name, data: i.blob })));
      downloadBlob(blob, zipName || 'cx-tools.zip');
      btn.textContent = 'Свалено ✓';
      announce('Архивът е свален.');
      window.setTimeout(() => {
        btn.disabled = false;
        btn.textContent = original;
      }, 2200);
    } catch (err) {
      for (const item of items) {
        downloadBlob(item.blob, item.name);
      }
      btn.textContent = 'Свалени един по един';
      announce(err && err.message ? err.message : 'Архивът не се получи, свалих файловете един по един.');
      window.setTimeout(() => {
        btn.disabled = false;
        btn.textContent = original;
      }, 2600);
    }
  });
  return btn;
}

/** Replace the whole app area with one message (used for fatal errors). */
export function fatal(app, message, retry) {
  app.innerHTML = '';
  const box = h('div', { class: 'panel' }, note(message, 'bad'));
  if (retry) {
    const again = h('button', { type: 'button', class: 'btn ghost', style: 'margin-top:12px' }, 'Опитай отново');
    again.addEventListener('click', retry);
    box.append(again);
  }
  app.append(box);
}

export { formatBytes, downloadBlob, h };
