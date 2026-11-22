// Снимка към PDF — several photos into one document, in the order you choose,
// rotated where you need it. pdf-lib is loaded only when the PDF is built.

import { h, formatBytes, downloadBlob, yieldToUI } from '../lib/util.js';
import { decodeImage } from '../lib/image.js';
import { looksLikeHeic, heicToCanvas } from '../lib/heic.js';
import { announce, remember } from '../shell.js';
import { panel, note, dropZone, progressBlock } from './kit.js';

const PAGE_SIZES = {
  a4: { label: 'A4', size: [595.28, 841.89] },
  letter: { label: 'Letter', size: [612, 792] },
  fit: { label: 'Колкото снимката', size: null },
};

function isImageish(file) {
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  return /\.(jpe?g|png|webp|heic|heif|gif|bmp|avif)$/i.test(file.name || '');
}

async function decodeAny(file) {
  if (await looksLikeHeic(file)) {
    const canvas = await heicToCanvas(file);
    return { source: canvas, width: canvas.width, height: canvas.height, close() {} };
  }
  return decodeImage(file);
}

/** Draw a decoded image onto a canvas, rotated by 0/90/180/270 and scaled down. */
function canvasRotated(decoded, rotation, maxEdge = 2200) {
  const scale = Math.min(1, maxEdge / Math.max(decoded.width, decoded.height));
  const w = Math.max(1, Math.round(decoded.width * scale));
  const height = Math.max(1, Math.round(decoded.height * scale));
  const swap = rotation % 180 !== 0;
  const canvas = document.createElement('canvas');
  canvas.width = swap ? height : w;
  canvas.height = swap ? w : height;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(decoded.source, -w / 2, -height / 2, w, height);
  return canvas;
}

function canvasToJpeg(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Снимката не може да се запише в PDF.'))), 'image/jpeg', 0.9);
  });
}

export function start() {
  const app = document.getElementById('app');
  if (!app) return;
  const state = {
    items: [],
    page: remember('pdf-page') || 'a4',
    busy: false,
    dragFrom: -1,
  };

  function addFiles(files) {
    for (const file of files) {
      if (!isImageish(file)) continue;
      state.items.push({ file, url: URL.createObjectURL(file), rotation: 0, heic: /\.(heic|heif)$/i.test(file.name) });
    }
    render();
  }

  function move(from, to) {
    if (to < 0 || to >= state.items.length) return;
    const [item] = state.items.splice(from, 1);
    state.items.splice(to, 0, item);
    render();
  }

  function pix(i) {
    return h(
      'div',
      {
        class: 'pitem',
        draggable: 'true',
        ondragstart: (e) => {
          state.dragFrom = i;
          e.currentTarget.classList.add('dragging');
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        },
        ondragend: (e) => {
          e.currentTarget.classList.remove('dragging');
          state.dragFrom = -1;
        },
        ondragover: (e) => {
          e.preventDefault();
          e.currentTarget.classList.add('over');
        },
        ondragleave: (e) => e.currentTarget.classList.remove('over'),
        ondrop: (e) => {
          e.preventDefault();
          e.currentTarget.classList.remove('over');
          if (state.dragFrom >= 0 && state.dragFrom !== i) move(state.dragFrom, i);
        },
      },
      state.items[i].heic
        ? h('span', { class: 'thumb-mono' }, 'HEIC')
        : h('img', {
            src: state.items[i].url,
            alt: '',
            style: `transform: rotate(${state.items[i].rotation}deg)`,
            loading: 'lazy',
          }),
      h(
        'span',
        {},
        h('span', { class: 'pname', title: state.items[i].file.name }, state.items[i].file.name),
        h(
          'span',
          { class: 'psub' },
          `${formatBytes(state.items[i].file.size)}${state.items[i].rotation ? ` · ${state.items[i].rotation}°` : ''}`,
        ),
      ),
      h(
        'span',
        { class: 'pacts' },
        h('button', { type: 'button', 'aria-label': 'Премести нагоре', onclick: () => move(i, i - 1) }, '↑'),
        h('button', { type: 'button', 'aria-label': 'Премести надолу', onclick: () => move(i, i + 1) }, '↓'),
        h(
          'button',
          {
            type: 'button',
            'aria-label': 'Завърти на 90 градуса',
            onclick: () => {
              state.items[i].rotation = (state.items[i].rotation + 90) % 360;
              render();
            },
          },
          '↻',
        ),
        h(
          'button',
          {
            type: 'button',
            'aria-label': 'Махни снимката',
            onclick: () => {
              URL.revokeObjectURL(state.items[i].url);
              state.items.splice(i, 1);
              render();
            },
          },
          '×',
        ),
      ),
    );
  }

  function render() {
    app.innerHTML = '';
    const pick = dropZone({
      title: state.items.length ? 'Добави още снимки' : 'Докосни снимките за PDF',
      hint: 'или ги пусни тук. Редът им е редът на страниците — можеш да го промениш.',
      accept: 'image/*,.heic,.heif',
      filter: isImageish,
      onFiles: addFiles,
    });

    const pageChips = Object.entries(PAGE_SIZES).map(([id, cfg]) =>
      h(
        'button',
        {
          type: 'button',
          class: 'chip',
          'aria-pressed': id === state.page ? 'true' : 'false',
          onclick: () => {
            state.page = id;
            remember('pdf-page', id);
            render();
          },
        },
        cfg.label,
      ),
    );

    app.append(
      panel(
        h('h2', {}, 'Снимките за документа'),
        h('p', { class: 'hint' }, 'Подреди ги, завърти ги ако трябва, и ги обедини в един PDF.'),
        pick.zone,
        state.items.length
          ? h(
              'div',
              { class: 'row' },
              h('b', {}, `${state.items.length} ${state.items.length === 1 ? 'страница' : 'страници'}`),
              h('span', { class: 'meta' }, formatBytes(state.items.reduce((s, it) => s + it.file.size, 0))),
              h('span'),
            )
          : null,
        state.items.length ? h('div', { class: 'pages' }, ...state.items.map((_it, i) => pix(i))) : null,
        state.items.length
          ? h(
              'p',
              { class: 'small muted', style: 'margin:10px 0 0' },
              'Плъзни реда с мишката, за да го преместиш, или използвай стрелките на телефона.',
            )
          : null,
        h('h2', { style: 'margin-top:18px' }, 'Размер на страницата'),
        h('div', { class: 'chips', style: 'margin-top:8px' }, ...pageChips),
        note('Снимките се събират в PDF тук, в браузъра. Нищо не се качва.'),
        state.items.length
          ? h(
              'button',
              { type: 'button', class: 'btn', style: 'margin-top:12px', onclick: build },
              `Направи PDF от ${state.items.length} ${state.items.length === 1 ? 'снимка' : 'снимки'}`,
            )
          : null,
      ),
    );
  }

  async function build() {
    if (state.busy || !state.items.length) return;
    state.busy = true;
    const items = state.items.slice();
    const pageKind = state.page;
    app.innerHTML = '';
    const progress = progressBlock('Създаване на PDF');
    app.append(panel(progress.root, note('PDF библиотеката се зарежда при първия файл. Нищо не се качва.')));

    try {
      const { PDFDocument } = await import('../../../vendor/pdf-lib/pdf-lib.esm.min.js');
      const pdf = await PDFDocument.create();

      const failures = [];
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        const row = progress.row(item.file.name);
        row.setState('обработва се…', 'busy');
        progress.set(i / items.length, `страница ${i + 1} от ${items.length}`);
        await yieldToUI();
        let decoded = null;
        let page = null;
        try {
          decoded = await decodeAny(item.file);
          if (!(decoded.width > 0 && decoded.height > 0)) {
            throw new Error('снимката се разчете като празна (0 пиксела)');
          }
          const canvas = canvasRotated(decoded, item.rotation, 2200);
          const jpeg = await canvasToJpeg(canvas);
          const image = await pdf.embedJpg(await jpeg.arrayBuffer());
          // pdf-lib reads the size out of the JPEG; fall back to the canvas we
          // just drew, so a photo can never land on a 1×1 page.
          const imgW = Number(image.width) || canvas.width;
          const imgH = Number(image.height) || canvas.height;
          if (!(imgW > 0 && imgH > 0)) throw new Error('снимката няма размери в пиксели');

          // Work out the page size and where the photo sits on it BEFORE adding
          // the page, so a failure here cannot leave an empty page behind.
          let pageW;
          let pageH;
          let place;
          if (PAGE_SIZES[pageKind].size) {
            const [baseW, baseH] = PAGE_SIZES[pageKind].size;
            const landscape = imgW > imgH;
            pageW = landscape ? baseH : baseW;
            pageH = landscape ? baseW : baseH;
            const margin = 18;
            const scale = Math.min((pageW - margin * 2) / imgW, (pageH - margin * 2) / imgH);
            place = {
              x: (pageW - imgW * scale) / 2,
              y: (pageH - imgH * scale) / 2,
              width: imgW * scale,
              height: imgH * scale,
            };
          } else {
            pageW = imgW;
            pageH = imgH;
            place = { x: 0, y: 0, width: imgW, height: imgH };
          }

          page = pdf.addPage([pageW, pageH]);
          page.drawImage(image, place);
          row.setState('готова', 'done');
          row.setMeta(`${canvas.width}×${canvas.height}`);
          canvas.width = 1;
          canvas.height = 1;
        } catch (err) {
          // A page added before the failure would sit in the document empty.
          // Take it back out, so the PDF only ever holds finished pages.
          if (page) {
            try {
              pdf.removePage(pdf.getPageCount() - 1);
            } catch (_ignored) {
              /* nothing to take back */
            }
          }
          const reason = err && err.message ? err.message : 'не се получи';
          row.setState('грешка', 'fail');
          row.setMeta(reason);
          failures.push({ name: item.file.name, reason });
        } finally {
          if (decoded) decoded.close();
        }
      }

      progress.set(1, 'Записвам PDF…');
      const pages = pdf.getPageCount();
      if (!pages) {
        const first = failures[0];
        throw new Error(
          first
            ? `Нито една снимка не влезе в PDF. ${first.name}: ${first.reason}`
            : 'PDF-ът остана без страници.',
        );
      }
      const bytes = await pdf.save();
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const name = `dokument-${new Date().toISOString().slice(0, 10)}.pdf`;
      app.innerHTML = '';
      app.append(
        panel(
          h('div', { class: 'row' }, h('b', {}, 'Готово'), h('span', { class: 'badge' }, `${pages} стр.`), h('span')),
          h('div', { class: 'row' }, h('span', {}, 'Размер'), h('span', { class: 'big', style: 'font-size:20px' }, formatBytes(blob.size)), h('span')),
          failures.length
            ? note(
                `Влязоха ${pages} от ${items.length} снимки. Тези не се получиха: ${failures.map((f) => f.name).join(', ')} — ${failures[0].reason}.`,
                'warn',
              )
            : null,
          h('button', { type: 'button', class: 'btn', style: 'margin-top:12px', onclick: () => downloadBlob(blob, name) }, `Свали PDF (${formatBytes(blob.size)})`),
          h('p', { class: 'small muted', style: 'margin:12px 0 0' }, 'Файлът е в „Изтегляния“ на телефона.'),
          h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn small', onclick: render }, '← назад към снимките')),
        ),
      );
      announce(`PDF с ${pages} страници е готов.`);
    } catch (err) {
      app.innerHTML = '';
      app.append(
        panel(
          note(`PDF не се получи: ${err && err.message ? err.message : 'непозната грешка'}`, 'bad'),
          h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn small', onclick: render }, '← назад')),
        ),
      );
    } finally {
      state.busy = false;
    }
  }

  render();
}
