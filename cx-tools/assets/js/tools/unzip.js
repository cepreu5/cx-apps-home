// Отвори ZIP — list what is inside an archive and download a single file or all.

import { h, formatBytes, downloadBlob } from '../lib/util.js';
import { readZip, ZIP_LIMITS } from '../lib/zip-read.js';
import { createZip } from '../lib/zip-write.js';
import { announce } from '../shell.js';
import { panel, note, dropZone, progressBlock } from './kit.js';

const PREVIEW_ROWS = 400;

function isZip(file) {
  const type = (file.type || '').toLowerCase();
  return type.includes('zip') || /\.(zip|cbz|docx|xlsx|pptx|jar|apk|epub)$/i.test(file.name || '');
}

export function start() {
  const app = document.getElementById('app');
  if (!app) return;
  const state = { archive: null, file: null, busy: false, filter: '' };

  async function open(files) {
    const file = files.find(isZip) || files[0];
    if (!file) return;
    app.innerHTML = '';
    const progress = progressBlock('Четене на архива');
    app.append(panel(progress.root));
    progress.set(0.3, 'Чета индекса на архива…');
    try {
      const archive = await readZip(file);
      state.archive = archive;
      state.file = file;
      state.filter = '';
      render();
      announce('Архивът има ' + archive.entries.length + ' файла.');
    } catch (err) {
      app.innerHTML = '';
      app.append(
        panel(
          note('Архивът не се отвори: ' + (err && err.message ? err.message : 'непозната грешка'), 'bad'),
          h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn small', onclick: render }, '← назад')),
        ),
      );
    }
  }

  function render() {
    app.innerHTML = '';
    const pick = dropZone({
      title: state.archive ? 'Друг архив' : 'Докосни ZIP архива',
      hint: 'или го пусни тук. Архивът остава на устройството ти.',
      accept: '.zip,application/zip',
      multiple: false,
      onFiles: open,
    });
    const archive = state.archive;

    if (!archive) {
      app.append(
        panel(
          h('h2', {}, 'Виж какво има в архива'),
          h('p', { class: 'hint' }, 'Показвам файловете и размерите. Разопаковам само това, което поискаш.'),
          pick.zone,
          note('Архивът се чете в браузъра. Нищо не се качва.'),
        ),
      );
      return;
    }

    const guard = archive.guard();
    const entries = archive.entries;
    const shown = entries.filter((e) => !state.filter || e.name.toLowerCase().includes(state.filter.toLowerCase()));

    const search = h('input', {
      type: 'search',
      class: 'search',
      placeholder: 'Търси по име…',
      'aria-label': 'Търси файл в архива',
      value: state.filter,
      oninput: (e) => {
        state.filter = e.target.value;
        const list = document.getElementById('entries');
        if (list) {
          const next = entriesList();
          list.replaceWith(next);
        }
      },
    });

    function entriesList() {
      const rows = h('div', { class: 'rows roll', id: 'entries' });
      const slice = shown.slice(0, PREVIEW_ROWS);
      for (const entry of slice) {
        const btn = h('button', { type: 'button', 'aria-label': 'Свали ' + entry.name }, 'свали');
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          btn.textContent = '…';
          try {
            const bytes = await archive.extract(entry);
            const name = entry.name.split('/').pop() || entry.name;
            downloadBlob(new Blob([bytes]), name);
            btn.textContent = 'свалено';
          } catch (err) {
            btn.textContent = 'грешка';
            announce(err && err.message ? err.message : 'Файлът не се разопакова.');
          }
          window.setTimeout(() => {
            btn.disabled = false;
            btn.textContent = 'свали';
          }, 1800);
        });
        rows.append(
          h(
            'div',
            { class: 'row' },
            h('span', { class: 'name', title: entry.name }, entry.name),
            h('span', { class: 'meta' }, formatBytes(entry.uncompSize)),
            h('span', { class: 'acts' }, btn),
          ),
        );
      }
      if (!slice.length) rows.append(h('p', { class: 'small muted' }, 'Няма файл с това име.'));
      if (shown.length > slice.length) {
        rows.append(
          h('p', { class: 'small muted', style: 'margin:8px 0 0' }, 'Показани са първите ' + PREVIEW_ROWS + ' от ' + shown.length + ' файла.'),
        );
      }
      return rows;
    }

    const zipAll = h(
      'button',
      {
        type: 'button',
        class: 'btn',
        style: 'margin-top:12px',
        disabled: !guard.safeToExtractAll,
        onclick: extractAll,
      },
      'Свали всички (' + formatBytes(archive.totalUncompressed) + ' разопаковани)',
    );

    app.append(
      panel(
        h('div', { class: 'row' }, h('b', {}, state.file.name), h('span', { class: 'meta' }, formatBytes(state.file.size)), h('span')),
        h(
          'div',
          { class: 'row' },
          h('span', {}, 'Вътре'),
          h('span', { class: 'meta' }, entries.length + ' файла · ' + formatBytes(archive.totalUncompressed)),
          h('span'),
        ),
        ...guard.problems.map((text) => note(text, 'warn')),
        h(
          'div',
          { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn small', onclick: () => downloadBlob(state.file, state.file.name) }, 'Свали оригинала'),
        ),
        zipAll,
        h('h2', { style: 'margin-top:18px' }, 'Файлове в архива'),
        search,
        entriesList(),
        h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn small', onclick: render }, '← друг архив')),
      ),
    );
  }

  async function extractAll() {
    if (state.busy || !state.archive) return;
    const archive = state.archive;
    state.busy = true;
    app.innerHTML = '';
    const progress = progressBlock('Разопаковане');
    app.append(panel(progress.root));
    const produced = [];
    const entries = archive.entries.slice(0, ZIP_LIMITS.maxEntries);
    try {
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        progress.set(i / entries.length, i + ' от ' + entries.length + ' файла');
        try {
          const bytes = await archive.extract(entry);
          produced.push({ name: entry.name, data: bytes });
        } catch (_err) {
          /* one broken entry must not stop the rest */
        }
      }
      progress.set(0.99, 'Сгъвам новия архив…');
      const blob = await createZip(produced);
      const name = (state.file.name || 'arhiv.zip').replace(/\.zip$/i, '') + '-razopakovan.zip';
      downloadBlob(blob, name);
      app.innerHTML = '';
      app.append(
        panel(
          h('div', { class: 'row' }, h('b', {}, 'Готово'), h('span', { class: 'badge' }, produced.length + ' файла'), h('span')),
          h('p', { class: 'small muted' }, 'Свален е нов архив с ' + produced.length + ' файла.'),
          h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn small', onclick: render }, '← назад към списъка')),
        ),
      );
      announce('Архивът с всички файлове е свален.');
    } catch (err) {
      app.innerHTML = '';
      app.append(
        panel(
          note('Разопаковането спря: ' + (err && err.message ? err.message : 'непозната грешка'), 'bad'),
          h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn small', onclick: render }, '← назад')),
        ),
      );
    } finally {
      state.busy = false;
    }
  }

  render();
}
