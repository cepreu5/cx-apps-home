// PDF инструменти — merge several PDFs, or lift page ranges out of one.
// pdf-lib is loaded on first use and then kept in memory for the session.

import { h, formatBytes, downloadBlob, parseRanges, pagesFromRanges, yieldToUI } from '../lib/util.js';
import { createZip } from '../lib/zip-write.js';
import { announce } from '../shell.js';
import { panel, note, dropZone, progressBlock } from './kit.js';

let pdfLibPromise = null;
function loadPdfLib() {
  if (!pdfLibPromise) pdfLibPromise = import('../../../vendor/pdf-lib/pdf-lib.esm.min.js');
  return pdfLibPromise;
}

function isPdf(file) {
  const type = (file.type || '').toLowerCase();
  return type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
}

async function describePdf(file) {
  const { PDFDocument } = await loadPdfLib();
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    if (doc.isEncrypted) throw new Error('Този PDF е защитен с парола.');
    return { bytes, pages: doc.getPageCount() };
  } catch (err) {
    if (err && err.message === 'Този PDF е защитен с парола.') throw err;
    throw new Error('Този файл не се отваря като PDF.');
  }
}

export function start() {
  const app = document.getElementById('app');
  if (!app) return;
  const state = { tab: 'merge', merge: [], split: null, mode: 'one', busy: false };

  function tabs() {
    const make = (id, label) =>
      h(
        'button',
        {
          type: 'button',
          class: 'chip',
          'aria-pressed': state.tab === id ? 'true' : 'false',
          onclick: () => {
            state.tab = id;
            render();
          },
        },
        label,
      );
    return h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'PDF инструмент' }, make('merge', 'Съедини'), make('split', 'Раздели'));
  }

  async function addMerge(files) {
    for (const file of files) {
      if (!isPdf(file)) continue;
      const entry = { file, pages: null, error: null };
      state.merge.push(entry);
      render();
      try {
        const info = await describePdf(file);
        entry.pages = info.pages;
        entry.bytes = info.bytes;
      } catch (err) {
        entry.error = err.message;
      }
      render();
    }
  }

  async function addSplit(files) {
    const file = files.find(isPdf);
    if (!file) {
      render('Приемам само PDF файлове.');
      return;
    }
    try {
      const info = await describePdf(file);
      state.split = { file, pages: info.pages, bytes: info.bytes };
      render();
    } catch (err) {
      render(err.message);
    }
  }

  function move(from, to) {
    if (to < 0 || to >= state.merge.length) return;
    const [item] = state.merge.splice(from, 1);
    state.merge.splice(to, 0, item);
    render();
  }

  function mergePanel() {
    const pick = dropZone({
      title: state.merge.length ? 'Добави още PDF' : 'Докосни PDF файловете',
      hint: 'или ги пусни тук. Редът им е редът в готовия документ.',
      accept: '.pdf,application/pdf',
      filter: isPdf,
      onFiles: addMerge,
    });
    const totalPages = state.merge.reduce((s, e) => s + (e.pages || 0), 0);
    return panel(
      h('h2', {}, 'Съедини няколко PDF в един'),
      h('p', { class: 'hint' }, 'Документите се подреждат в списъка. Можеш да разместиш всеки с ↑ ↓.'),
      pick.zone,
      state.merge.length
        ? h(
            'div',
            { class: 'rows' },
            ...state.merge.map((entry, i) =>
              h(
                'div',
                { class: 'row filerow' },
                h('span', { class: 'name', title: entry.file.name }, entry.file.name),
                h(
                  'span',
                  { class: 'meta' },
                  entry.error ? entry.error : entry.pages === null ? '…' : `${entry.pages} стр. · ${formatBytes(entry.file.size)}`,
                ),
                h(
                  'span',
                  { class: 'acts' },
                  h('button', { type: 'button', 'aria-label': 'Премести нагоре', onclick: () => move(i, i - 1) }, '↑'),
                  h('button', { type: 'button', 'aria-label': 'Премести надолу', onclick: () => move(i, i + 1) }, '↓'),
                  h(
                    'button',
                    {
                      type: 'button',
                      'aria-label': 'Махни файла',
                      onclick: () => {
                        state.merge.splice(i, 1);
                        render();
                      },
                    },
                    '×',
                  ),
                ),
              ),
            ),
          )
        : null,
      state.merge.length
        ? h('div', { class: 'row' }, h('b', {}, 'Общо'), h('span', { class: 'meta' }, `${totalPages} страници`), h('span'))
        : null,
      note('Съединяването става в браузъра. Файловете не се качват никъде.'),
      state.merge.length >= 2
        ? h(
            'button',
            { type: 'button', class: 'btn', style: 'margin-top:12px', onclick: merge },
            `Съедини ${state.merge.length} PDF`,
          )
        : state.merge.length
          ? h('p', { class: 'small muted', style: 'margin:12px 0 0' }, 'Добави поне още един PDF, за да има какво да се съедини.')
          : null,
    );
  }

  function splitPanel(message) {
    const pick = dropZone({
      title: state.split ? 'Друг PDF' : 'Докосни PDF файла',
      hint: 'или го пусни тук — ще извадим само страниците, които кажеш.',
      accept: '.pdf,application/pdf',
      multiple: false,
      filter: isPdf,
      onFiles: addSplit,
    });

    const rangeInput = h('input', {
      type: 'text',
      id: 'ranges',
      placeholder: 'например 1-3,7,10-12',
      inputmode: 'numeric',
      autocomplete: 'off',
      'aria-describedby': 'ranges-help',
    });
    const modeChip = (id, label) =>
      h(
        'button',
        {
          type: 'button',
          class: 'chip',
          'aria-pressed': state.mode === id ? 'true' : 'false',
          onclick: () => {
            state.mode = id;
            render();
          },
        },
        label,
      );

    return panel(
      h('h2', {}, 'Извади страници от PDF'),
      h('p', { class: 'hint' }, 'Полезно, когато ти трябват две страници от дълъг документ.'),
      pick.zone,
      message ? note(message, 'warn') : null,
      state.split
        ? h(
            'div',
            { class: 'row' },
            h('b', {}, state.split.file.name),
            h('span', { class: 'meta' }, `${state.split.pages} стр. · ${formatBytes(state.split.file.size)}`),
            h('span'),
          )
        : null,
      state.split
        ? h(
            'div',
            { class: 'field' },
            h('label', { for: 'ranges' }, 'Кои страници?'),
            rangeInput,
            h('span', { class: 'small muted', id: 'ranges-help' }, 'Пиши като 1-3,7,10-12. Страниците се броят от 1.'),
          )
        : null,
      state.split ? h('h2', { style: 'margin-top:18px' }, 'Как да ги получа?') : null,
      state.split
        ? h('div', { class: 'chips', style: 'margin-top:8px' }, modeChip('one', 'Един PDF'), modeChip('many', 'Отделни файлове'))
        : null,
      note('Изваждането става на твоето устройство. Нищо не се качва.'),
      state.split
        ? h(
            'button',
            { type: 'button', class: 'btn', style: 'margin-top:12px', onclick: () => split(rangeInput.value) },
            state.mode === 'one' ? 'Извади в един PDF' : 'Извади като отделни файлове',
          )
        : null,
    );
  }

  function render(message) {
    app.innerHTML = '';
    app.append(tabs());
    app.append(state.tab === 'merge' ? mergePanel() : splitPanel(message));
  }

  async function merge() {
    if (state.busy) return;
    const entries = state.merge.filter((e) => e.bytes);
    if (entries.length < 2) return;
    state.busy = true;
    app.innerHTML = '';
    const progress = progressBlock('Съединяване');
    app.append(panel(progress.root));
    try {
      const { PDFDocument } = await loadPdfLib();
      const out = await PDFDocument.create();
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        const row = progress.row(entry.file.name);
        progress.set(i / entries.length, `${i} от ${entries.length} документа`);
        await yieldToUI();
        try {
          const doc = await PDFDocument.load(entry.bytes, { ignoreEncryption: true });
          const pages = await out.copyPages(doc, doc.getPageIndices());
          for (const page of pages) out.addPage(page);
          row.setState('добавен', 'done');
          row.setMeta(`${pages.length} стр.`);
        } catch (err) {
          row.setState('пропуснат', 'fail');
          row.setMeta(err && err.message ? err.message : 'не се отвори');
        }
      }
      const bytes = await out.save();
      const blob = new Blob([bytes], { type: 'application/pdf' });
      showResult(`suedinen-${new Date().toISOString().slice(0, 10)}.pdf`, blob, `${out.getPageCount()} страници`);
    } catch (err) {
      fail(err);
    } finally {
      state.busy = false;
    }
  }

  async function split(text) {
    if (state.busy || !state.split) return;
    let ranges;
    try {
      ranges = parseRanges(text, state.split.pages);
    } catch (err) {
      render(err.message);
      const input = document.getElementById('ranges');
      if (input) {
        input.value = text;
        input.focus();
      }
      return;
    }
    state.busy = true;
    app.innerHTML = '';
    const progress = progressBlock('Изваждане на страници');
    app.append(panel(progress.root));
    try {
      const { PDFDocument } = await loadPdfLib();
      const source = await PDFDocument.load(state.split.bytes, { ignoreEncryption: true });
      const stamp = new Date().toISOString().slice(0, 10);

      if (state.mode === 'one') {
        progress.row(state.split.file.name).setState('работи…', 'busy');
        progress.set(0.4, 'Изваждам страниците…');
        await yieldToUI();
        const out = await PDFDocument.create();
        const pages = pagesFromRanges(ranges).map((p) => p - 1);
        const copied = await out.copyPages(source, pages);
        for (const page of copied) out.addPage(page);
        const bytes = await out.save();
        showResult(`izvadka-${stamp}.pdf`, new Blob([bytes], { type: 'application/pdf' }), `${out.getPageCount()} страници`);
      } else {
        const base = state.split.file.name.replace(/\.pdf$/i, '');
        const produced = [];
        for (let i = 0; i < ranges.length; i += 1) {
          const [a, b] = ranges[i];
          const row = progress.row(`${base}-${a}${b > a ? `-${b}` : ''}.pdf`);
          progress.set((i + 1) / ranges.length, `${i + 1} от ${ranges.length}`);
          await yieldToUI();
          try {
            const out = await PDFDocument.create();
            const pages = [];
            for (let p = a; p <= b; p += 1) pages.push(p - 1);
            const copied = await out.copyPages(source, pages);
            for (const page of copied) out.addPage(page);
            const bytes = await out.save();
            produced.push({
              name: `${base}-${a}${b > a ? `-${b}` : ''}.pdf`,
              blob: new Blob([bytes], { type: 'application/pdf' }),
              meta: `${b - a + 1} стр.`,
            });
            row.setState('готова', 'done');
          } catch (err) {
            row.setState('грешка', 'fail');
            row.setMeta(err && err.message ? err.message : '');
          }
        }
        const zip = await createZip(produced.map((p) => ({ name: p.name, data: p.blob })));
        app.innerHTML = '';
        app.append(
          panel(
            h('div', { class: 'row' }, h('b', {}, 'Готово'), h('span', { class: 'badge' }, `${produced.length} файла`), h('span')),
            h('button', { type: 'button', class: 'btn', onclick: () => downloadBlob(zip, `izvadka-${stamp}.zip`) }, `Свали всички (${formatBytes(zip.size)})`),
            h(
              'div',
              { class: 'rows' },
              ...produced.map((p) =>
                h(
                  'div',
                  { class: 'row filerow' },
                  h('span', { class: 'name' }, p.name),
                  h('span', { class: 'meta' }, p.meta),
                  h('span', { class: 'acts' }, h('button', { type: 'button', onclick: () => downloadBlob(p.blob, p.name) }, 'свали')),
                ),
              ),
            ),
            h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn small', onclick: render }, '← назад')),
          ),
        );
        announce(`Готови са ${produced.length} файла.`);
      }
    } catch (err) {
      fail(err);
    } finally {
      state.busy = false;
    }
  }

  function showResult(name, blob, meta) {
    app.innerHTML = '';
    app.append(
      panel(
        h('div', { class: 'row' }, h('b', {}, 'Готово'), h('span', { class: 'badge' }, meta), h('span')),
        h('button', { type: 'button', class: 'btn', style: 'margin-top:12px', onclick: () => downloadBlob(blob, name) }, `Свали ${name} (${formatBytes(blob.size)})`),
        h('p', { class: 'small muted', style: 'margin:12px 0 0' }, 'Файлът е в „Изтегляния“ на телефона.'),
        h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn small', onclick: render }, '← назад')),
      ),
    );
    announce(`${name} е готов.`);
  }

  function fail(err) {
    app.innerHTML = '';
    app.append(
      panel(
        note(`Не се получи: ${err && err.message ? err.message : 'непозната грешка'}`, 'bad'),
        h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn small', onclick: render }, '← назад')),
      ),
    );
  }

  render();
}
