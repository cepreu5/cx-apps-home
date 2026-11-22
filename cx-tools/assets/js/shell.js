// Page shell shared by every tool: the light/dark switch, the service worker,
// the live region and the file-picking helpers.

const MODE_KEY = 'cx-tools-mode';

export function applyMode(mode) {
  document.documentElement.dataset.appMode = mode;
  document.documentElement.style.colorScheme = mode === 'light' ? 'light' : 'dark';
}

export function currentMode() {
  return document.documentElement.dataset.appMode === 'light' ? 'light' : 'dark';
}

export function setMode(mode) {
  applyMode(mode);
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch (_err) {
    /* storage blocked — this page only */
  }
  paintModeButtons();
}

function paintModeButtons() {
  const mode = currentMode();
  for (const btn of document.querySelectorAll('[data-mode-toggle]')) {
    const label = mode === 'dark' ? 'Светъл режим' : 'Тъмен режим';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
    // The button shows only an icon (sun or moon, chosen in CSS by the mode);
    // the label lives in aria-label and title for screen readers and long-press.
  }
}

/** Announce something for screen readers without moving focus. */
export function announce(text) {
  const region = document.getElementById('live');
  if (!region) return;
  region.textContent = '';
  window.setTimeout(() => {
    region.textContent = text;
  }, 30);
}

/**
 * Wire a drop zone. `zone` is the visible label; `input` the file input inside
 * it. Files arriving by either route are handed to onFiles.
 */
export function wireFiles(zone, input, onFiles, options = {}) {
  const { accept } = options;
  const take = (list) => {
    const files = Array.from(list || []);
    if (!files.length) return;
    onFiles(files);
  };
  if (input) {
    input.addEventListener('change', () => {
      take(input.files);
      input.value = '';
    });
  }
  if (!zone) return;
  let depth = 0;
  zone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    depth += 1;
    zone.classList.add('over');
  });
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  });
  zone.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) zone.classList.remove('over');
  });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    zone.classList.remove('over');
    const dt = e.dataTransfer;
    if (!dt) return;
    const files = Array.from(dt.files || []);
    const usable = accept ? files.filter(accept) : files;
    if (usable.length) onFiles(usable);
    else if (files.length) announce('Този вид файл не се поддържа от инструмента.');
  });
}

/** Show a Bulgarian error inside `node` as a note, replacing its content. */
export function showError(node, message) {
  if (!node) return;
  node.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'note bad';
  box.setAttribute('role', 'alert');
  box.textContent = message;
  node.append(box);
}

export function clearNode(node) {
  if (!node) return;
  node.innerHTML = '';
}

/** Register the service worker so the app keeps working offline. */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;
  const url = new URL('../../sw.js', import.meta.url);
  // A phone can keep yesterday's files in the service worker cache. When a new
  // worker takes over, reload once so the page runs the new code — once only,
  // so this can never turn into a reload loop.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let justReloaded = false;
  try {
    justReloaded = sessionStorage.getItem('cx-sw-reload') === '1';
    if (justReloaded) sessionStorage.removeItem('cx-sw-reload');
  } catch (_err) {
    /* private mode: no session storage, no reload dance */
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || justReloaded) return;
    try {
      sessionStorage.setItem('cx-sw-reload', '1');
    } catch (_err) {
      /* ignore */
    }
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(url.href)
      .then((reg) => (reg ? reg.update() : null))
      .catch(() => {
        /* offline support is a bonus: never break the tool over it */
      });
  });
}

export function initShell() {
  for (const btn of document.querySelectorAll('[data-mode-toggle]')) {
    btn.addEventListener('click', () => setMode(currentMode() === 'dark' ? 'light' : 'dark'));
  }
  paintModeButtons();
  registerServiceWorker();
}

/** Read or write a remembered setting safely. */
export function remember(key, value) {
  try {
    if (value === undefined) return localStorage.getItem('cx-tools-' + key);
    localStorage.setItem('cx-tools-' + key, String(value));
  } catch (_err) {
    /* ignore */
  }
  return null;
}
