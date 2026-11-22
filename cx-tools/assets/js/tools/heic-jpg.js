// HEIC към JPG — decode iPhone photos locally with the vendored libheif wasm.

import { h, formatBytes, yieldToUI } from '../lib/util.js';
import { looksLikeHeic, heicToJpeg } from '../lib/heic.js';
import { announce } from '../shell.js';
import { panel, note, dropZone, progressBlock, resultRows, downloadAllButton } from './kit.js';

async function isHeicish(file) {
  try {
    return await looksLikeHeic(file);
  } catch (_err) {
    return false;
  }
}

const QUALITIES = [
  { value: 0.92, label: 'Най-високо' },
  { value: 0.85, label: 'Високо' },
  { value: 0.75, label: 'Средно' },
  { value: 0.6, label: 'По-малко' },
];

export function start() {
  const app = document.getElementById('app');
  if (!app) return;
  const state = { files: [], quality: 0.92, busy: false, failedNames: [] };

  async function addFiles(incoming) {
    for (const file of incoming) {
      if (!(await isHeicish(file))) continue;
      const dup = state.files.some((f) => f.name === file.name && f.size === file.size);
      if (!dup) state.files.push(file);
    }
    if (!state.files.length) {
      render('Не разпознах HEIC снимки в този избор. Приемам файлове .heic и .heif.');
    } else {
      render();
    }
  }

  function render(message) {
    app.innerHTML = '';
    const pick = dropZone({
      title: 'Докосни HEIC снимките',
      hint: 'или ги пусни тук — .heic и .heif от iPhone. Нищо не се качва.',
      accept: '.heic,.heif,image/heic,image/heif',
      onFiles: addFiles,
    });

    const list = h(
      'div',
      { class: 'rows' },
      ...state.files.map((file) =>
        h(
          'div',
          { class: 'row' },
          h('span', { class: 'name', title: file.name }, file.name),
          h('span', { class: 'meta' }, formatBytes(file.size)),
          h(
            'span',
            { class: 'acts' },
            h(
              'button',
              {
                type: 'button',
                'aria-label': `Махни ${file.name}`,
                onclick: () => {
                  state.files = state.files.filter((f) => f !== file);
                  render();
                },
              },
              'махни',
            ),
          ),
        ),
      ),
    );

    const qualityRow = h(
      'div',
      { class: 'field' },
      h('label', { for: 'q' }, 'Качество на JPG'),
      h('input', {
        id: 'q',
        type: 'range',
        min: '60',
        max: '95',
        step: '5',
        value: String(Math.round(state.quality * 100)),
        oninput: (e) => {
          state.quality = Number(e.target.value) / 100;
          const label = document.querySelector('[data-q-label]');
          if (label) label.textContent = `${e.target.value}%${state.quality >= 0.85 ? ' · високо' : ''}`;
        },
      }),
      h(
        'span',
        { class: 'val', 'data-q-label': '' },
        `${Math.round(state.quality * 100)}%${state.quality >= 0.85 ? ' · високо' : ''}`,
      ),
    );

    app.append(
      panel(
        h('h2', {}, 'Снимки от iPhone'),
        h('p', { class: 'hint' }, 'Превръщам ги в JPG, за да се отварят навсякъде и да се качват в портали.'),
        pick.zone,
        message ? note(message, 'warn') : null,
        state.files.length ? list : null,
        state.files.length
          ? h(
              'div',
              { class: 'row' },
              h('b', {}, `${state.files.length} ${state.files.length === 1 ? 'снимка' : 'снимки'}`),
              h('span', { class: 'meta' }, formatBytes(state.files.reduce((s, f) => s + f.size, 0))),
              h('span'),
            )
          : null,
        state.files.length ? qualityRow : null,
        state.files.length
          ? h(
              'button',
              { type: 'button', class: 'btn', style: 'margin-top:12px', onclick: run },
              `Превърни ${state.files.length} ${state.files.length === 1 ? 'снимка' : 'снимки'}`,
            )
          : null,
        note('Първият път се тегли HEIC декодерът (около 1.5 MB) от този сайт и остава в кеша. След това работи и офлайн.'),
      ),
    );
  }

  async function run() {
    if (state.busy || !state.files.length) return;
    state.busy = true;
    state.failedNames = [];
    const files = state.files.slice();
    const quality = state.quality;
    app.innerHTML = '';

    const progress = progressBlock('Превръщане на снимките');
    const head = h('div', { class: 'row' }, h('b', {}, 'HEIC към JPG'), h('span', { class: 'meta' }, `0 от ${files.length}`), h('span'));
    app.append(
      panel(head, progress.root, note('Декодерът се зарежда при първата снимка. Нищо не излиза от устройството.')),
    );

    const results = [];
    let failed = 0;

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const row = progress.row(file.name);
      row.setState('преобразува се…', 'busy');
      head.children[1].textContent = `${i} от ${files.length}`;
      progress.set(i / files.length, `${i} от ${files.length} готови`);
      await yieldToUI();
      try {
        const out = await heicToJpeg(file, quality);
        const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
        results.push({
          blob: out.blob,
          name,
          meta: `${out.width}×${out.height} · ${formatBytes(out.blob.size)}`,
        });
        row.setState('готово', 'done');
        row.setMeta(`${formatBytes(file.size)} → ${formatBytes(out.blob.size)}`);
      } catch (err) {
        failed += 1;
        const reason = err && err.message ? err.message : 'не се получи';
        state.failedNames.push(`${file.name}: ${reason}`);
        row.setState('грешка', 'fail');
        row.setMeta(reason);
      }
    }

    state.busy = false;
    state.files = [];
    showResult(results, failed);
  }

  function showResult(results, failed) {
    app.innerHTML = '';
    const after = results.reduce((s, r) => s + r.blob.size, 0);
    app.append(
      panel(
        h('div', { class: 'row' }, h('b', {}, 'Готово'), h('span', { class: 'badge' }, `${results.length} JPG`), h('span')),
        h(
          'div',
          { class: 'row' },
          h('span', {}, 'Общо'),
          h('span', { class: 'big', style: 'font-size:20px' }, formatBytes(after)),
          h('span'),
        ),
        results.length ? downloadAllButton(results, { zipName: 'heic-kam-jpg.zip', lead: 'Свали всички' }) : null,
        failed
          ? note(
              `${failed} ${failed === 1 ? 'файл не се получи' : 'файла не се получиха'}: ${state.failedNames.join('; ')}`,
              'warn',
            )
          : null,
        results.length ? resultRows(results) : null,
        h('p', { class: 'small muted', style: 'margin:12px 0 0' }, 'Файловете са в „Изтегляния“ на телефона.'),
        h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn small', onclick: render }, 'Нови снимки')),
      ),
    );
    announce(`Готово. ${results.length} снимки са превърнати в JPG.`);
  }

  render();
}

export const meta = { qualities: QUALITIES };
