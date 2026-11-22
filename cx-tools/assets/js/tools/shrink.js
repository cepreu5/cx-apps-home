// Смали снимки — batch image compression to a byte budget, all local.
//
// Two steps, as in the plan: (1) pick the photos, (2) choose how small they
// should get. Anything already under the chosen size is left exactly as it is
// instead of being re-encoded into something bigger.

import { h, formatBytes, pct, yieldToUI } from '../lib/util.js';
import { compressImage } from '../lib/image.js';
import { isImageish, decodeAny, fillThumbs } from '../lib/photo.js';
import { announce } from '../shell.js';
import { panel, note, stepLine, dropZone, progressBlock, resultRows, downloadAllButton } from './kit.js';

const TARGETS = [
  { id: '2mb', label: 'Под 2 MB', bytes: 2 * 1024 * 1024 },
  { id: '5mb', label: 'Под 5 MB', bytes: 5 * 1024 * 1024 },
  { id: '1mb', label: 'Под 1 MB', bytes: 1 * 1024 * 1024 },
  { id: 'scale', label: 'Само намали размера', bytes: null },
];

export function start() {
  const app = document.getElementById('app');
  if (!app) return;
  const state = { items: [], target: TARGETS[0].id, busy: false, step: 'pick', resultUrls: [] };
  let seq = 0;

  function addFiles(files) {
    const added = [];
    for (const file of files) {
      if (!isImageish(file)) continue;
      const duplicate = state.items.some((it) => it.file.name === file.name && it.file.size === file.size);
      if (duplicate) continue;
      const item = {
        id: (seq += 1),
        file,
        selected: true,
        previewUrl: URL.createObjectURL(file),
        thumbUrl: null,
        thumbState: 'pending',
        removed: false,
      };
      state.items.push(item);
      added.push(item);
    }
    render();
    // A HEIC photo has no thumbnail the browser can draw, so every photo gets a
    // small JPEG of its own instead of an empty square.
    fillThumbs(added, refreshThumb);
  }

  /** Put the real picture in a tile once its thumbnail exists. */
  function refreshThumb(item) {
    if (!item.thumbUrl) return;
    const btn = app.querySelector(`.th[data-id="${item.id}"]`);
    if (!btn) return;
    const img = h('img', { src: item.thumbUrl, alt: '', decoding: 'async' });
    const old = btn.querySelector('img, .ph');
    if (old) old.replaceWith(img);
    else btn.insertBefore(img, btn.firstChild);
  }

  function selected() {
    return state.items.filter((it) => it.selected);
  }

  function thumb(item) {
    const img = h('img', { src: item.thumbUrl || item.previewUrl, alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => {
      img.replaceWith(h('span', { class: 'ph' }, 'снимка'));
    });
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'th',
        'data-id': String(item.id),
        'aria-pressed': item.selected ? 'true' : 'false',
        'aria-label': (item.selected ? 'Махни ' : 'Добави ') + item.file.name,
        title: item.file.name,
      },
      img,
    );
    btn.addEventListener('click', () => {
      item.selected = !item.selected;
      render();
    });
    return btn;
  }

  function estimate() {
    const target = TARGETS.find((t) => t.id === state.target);
    const chosen = selected();
    if (!chosen.length) return { bytes: 0, todo: 0 };
    if (!target.bytes) {
      return { bytes: Math.round(chosen.reduce((s, it) => s + it.file.size, 0) * 0.45), todo: chosen.length };
    }
    const todo = chosen.filter((it) => it.file.size > target.bytes).length;
    return { bytes: chosen.reduce((s, it) => s + Math.min(it.file.size, target.bytes), 0), todo };
  }

  function render() {
    if (state.step === 'target' && selected().length) renderTarget();
    else renderPick();
  }

  function renderPick() {
    app.innerHTML = '';
    const chosen = selected();
    const total = chosen.reduce((s, it) => s + it.file.size, 0);

    const pick = dropZone({
      title: state.items.length ? 'Добави още снимки' : 'Докосни снимките, които да се смалят',
      hint: 'или ги пусни тук — JPG, PNG, WebP, HEIC. Нищо не се качва.',
      accept: 'image/*,.heic,.heif',
      filter: isImageish,
      onFiles: addFiles,
    });

    app.append(
      panel(
        stepLine(1, 2, `${chosen.length} избрани`),
        pick.zone,
        state.items.length ? h('div', { class: 'thumbs' }, ...state.items.map(thumb)) : null,
        state.items.length
          ? h(
              'div',
              { class: 'row' },
              h('b', {}, 'Общо сега'),
              h('span', { class: 'meta' }, `${chosen.length} снимки · ${formatBytes(total)}`),
              h('span'),
            )
          : null,
        state.items.length
          ? h(
              'p',
              { class: 'small muted', style: 'margin:10px 0 0' },
              'Докосни снимка, за да я махнеш от избора. Избрани са всички по подразбиране.',
            )
          : null,
        state.items.length
          ? h(
              'div',
              { class: 'btn-row' },
              h(
                'button',
                {
                  type: 'button',
                  class: 'btn',
                  style: 'margin:0',
                  disabled: chosen.length === 0,
                  onclick: () => {
                    state.step = 'target';
                    render();
                    window.scrollTo(0, 0);
                  },
                },
                'Напред',
              ),
            )
          : null,
      ),
    );
  }

  function renderTarget() {
    app.innerHTML = '';
    const chosen = selected();
    const target = TARGETS.find((t) => t.id === state.target);
    const guess = estimate();

    const chips = TARGETS.map((t) =>
      h(
        'button',
        {
          type: 'button',
          class: 'chip',
          'aria-pressed': t.id === target.id ? 'true' : 'false',
          onclick: () => {
            state.target = t.id;
            renderTarget();
          },
        },
        t.label,
      ),
    );

    app.append(
      panel(
        stepLine(2, 2, `${chosen.length} снимки`),
        h('h2', {}, 'Колко големи да станат?'),
        h('div', { class: 'chips', style: 'margin:10px 0 0' }, ...chips),
        h(
          'p',
          { class: 'hint', style: 'margin:12px 0 0' },
          target.bytes
            ? 'Снимките ще станат по-леки, но ще останат с достатъчно качество за екран и за печат.'
            : 'Само ще намалим размерите, без да пипаме повече от нужното качество.',
        ),
        h(
          'div',
          { class: 'row' },
          h('b', {}, `${chosen.length} ${chosen.length === 1 ? 'снимка' : 'снимки'}`),
          h('span', { class: 'meta' }, `≈ ${formatBytes(guess.bytes)}`),
          h('span'),
        ),
        target.bytes && guess.todo === 0
          ? note('Всички избрани снимки вече са под този размер — ще ги оставим точно както са.', 'neutral')
          : null,
        note('Всичко се смята на това устройство. Нито една снимка не се качва в интернет.'),
        h(
          'button',
          { type: 'button', class: 'btn', disabled: state.busy || chosen.length === 0, onclick: () => run(chosen) },
          `Смали ${chosen.length} ${chosen.length === 1 ? 'снимка' : 'снимки'}`,
        ),
        h(
          'div',
          { class: 'btn-row' },
          h(
            'button',
            {
              type: 'button',
              class: 'btn small',
              onclick: () => {
                state.step = 'pick';
                render();
                window.scrollTo(0, 0);
              },
            },
            '← назад',
          ),
          h('button', { type: 'button', class: 'btn small', onclick: resetAll }, 'изчисти избора'),
        ),
      ),
    );
  }

  function clearResultUrls() {
    for (const url of state.resultUrls) URL.revokeObjectURL(url);
    state.resultUrls = [];
  }

  function resetAll() {
    clearResultUrls();
    for (const it of state.items) {
      it.removed = true;
      URL.revokeObjectURL(it.previewUrl);
      if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
    }
    state.items = [];
    state.target = TARGETS[0].id;
    state.step = 'pick';
    render();
    announce('Изборът е изчистен.');
  }

  async function run(chosen) {
    if (state.busy) return;
    state.busy = true;
    clearResultUrls();
    const target = TARGETS.find((t) => t.id === state.target);
    app.innerHTML = '';

    const progress = progressBlock('Смаляване на снимките');
    const head = h(
      'div',
      { class: 'row' },
      h('b', {}, 'Смали снимки'),
      h('span', { class: 'meta' }, `0 от ${chosen.length}`),
      h('span'),
    );
    app.append(
      panel(head, progress.root, note('Интернет не е нужен за тази стъпка. Работи и в самолетен режим.')),
    );

    const results = [];
    const failures = [];
    const before = chosen.reduce((s, it) => s + it.file.size, 0);

    for (let i = 0; i < chosen.length; i += 1) {
      const item = chosen[i];
      const row = progress.row(item.file.name);
      head.children[1].textContent = `${i} от ${chosen.length}`;
      progress.set(i / chosen.length, `${i} от ${chosen.length} готови`);
      await yieldToUI();

      // Already small enough: keep the original bytes, do not re-encode.
      if (target.bytes && item.file.size <= target.bytes) {
        results.push({
          blob: item.file,
          name: item.file.name,
          meta: `${formatBytes(item.file.size)} · без промяна`,
          kept: true,
        });
        row.setState('готово', 'done');
        row.setMeta('вече е под лимита');
        continue;
      }

      let decoded = null;
      try {
        row.setState('смалява се…', 'busy');
        decoded = await decodeAny(item.file);
        const out = await compressImage(decoded, {
          targetBytes: target.bytes,
          maxLongEdge: target.bytes ? 4096 : 1600,
          quality: 0.88,
        });
        const name = item.file.name.replace(/\.[^.]+$/, '') + '.jpg';

        if (out.blob.size >= item.file.size && (!target.bytes || item.file.size <= target.bytes)) {
          results.push({ blob: item.file, name: item.file.name, meta: `${formatBytes(item.file.size)} · без промяна`, kept: true });
          row.setState('готово', 'done');
          row.setMeta('не се получи по-малко — остава оригинала');
        } else {
          results.push({
            blob: out.blob,
            name,
            quality: Math.round(out.quality * 100),
            meta: `${out.width}×${out.height} · ${formatBytes(out.blob.size)}`,
          });
          row.setState('готово', 'done');
          row.setMeta(`${formatBytes(item.file.size)} → ${formatBytes(out.blob.size)}`);
        }
      } catch (err) {
        const reason = err && err.message ? err.message : 'не се получи';
        failures.push(`${item.file.name}: ${reason}`);
        row.setState('грешка', 'fail');
        row.setMeta(reason);
      } finally {
        if (decoded) decoded.close();
      }
    }

    state.busy = false;
    progress.set(1, `${results.length} от ${chosen.length} готови`);
    showResult(results, failures, before, target);
  }

  function showResult(results, failures, before, target) {
    app.innerHTML = '';
    const after = results.reduce((s, r) => s + r.blob.size, 0);
    const converted = results.filter((r) => !r.kept);
    const kept = results.length - converted.length;
    const quality = converted.length ? converted[0].quality : 0;
    const change = pct(before, after);

    const thumbStrip = h(
      'div',
      { class: 'thumbs', 'aria-hidden': 'true', style: 'grid-template-columns:repeat(6,1fr)' },
      ...results.slice(0, 12).map((r) => {
        const url = URL.createObjectURL(r.blob);
        state.resultUrls.push(url);
        return h('span', { class: 'th' }, h('img', { src: url, alt: '', loading: 'lazy' }));
      }),
    );

    const formatText = converted.length
      ? `JPG · качество ${quality}%${kept ? ` · ${kept} без промяна` : ''}`
      : 'Оригинали · без промяна';

    app.append(
      panel(
        h(
          'div',
          { class: 'row' },
          h('b', {}, 'Готово'),
          h('span', { class: 'badge' }, `${change >= 0 ? '−' : '+'}${Math.abs(change)}%`),
          h('span', { class: 'meta' }, `${results.length} ${results.length === 1 ? 'снимка' : 'снимки'}`),
        ),
        h('div', { class: 'row' }, h('span', {}, 'Преди'), h('span', { class: 'meta' }, formatBytes(before)), h('span')),
        h(
          'div',
          { class: 'row' },
          h('span', {}, 'Сега'),
          h('span', { class: 'big', style: 'font-size:20px' }, formatBytes(after)),
          h('span'),
        ),
        h('div', { class: 'prog', 'aria-hidden': 'true' }, h('i', { style: '--v:1' })),
        h('div', { class: 'row' }, h('span', {}, 'Формат'), h('span', { class: 'meta' }, formatText), h('span')),
        h('div', { class: 'row' }, h('span', {}, 'Файлове'), h('span', { class: 'meta' }, `${results.length} готови`), h('span')),
        results.length ? downloadAllButton(results, { zipName: 'smaleni-snimki.zip', lead: 'Свали всички' }) : null,
        results.length ? thumbStrip : null,
        failures.length ? note(`${failures.length} ${failures.length === 1 ? 'файл не се получи' : 'файла не се получиха'}: ${failures.join('; ')}`, 'warn') : null,
        results.length ? resultRows(results) : null,
        h(
          'p',
          { class: 'small muted', style: 'margin:12px 0 0' },
          target.bytes && kept === results.length
            ? 'Всички снимки вече бяха под лимита, затова ги оставихме както са. Можеш да свалиш архива или да избереш по-малък размер.'
            : 'Файловете са в „Изтегляния“ на телефона. Можеш да ги изпратиш направо оттам.',
        ),
        h(
          'div',
          { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn small', onclick: resetAll }, 'Нови снимки'),
          h(
            'button',
            {
              type: 'button',
              class: 'btn small',
              onclick: () => {
                state.step = 'target';
                render();
                window.scrollTo(0, 0);
              },
            },
            'Друг размер',
          ),
        ),
      ),
    );
    announce(`Готово. ${results.length} снимки са смалени.`);
  }

  render();
}
