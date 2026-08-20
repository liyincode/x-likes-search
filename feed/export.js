import { buildLikesCSV, photoDownload } from "../core/export.js";

/** @typedef {import("../core/likes.js").GalleryPhotoItem} GalleryPhotoItem */
/** @typedef {typeof import("./state.js").appState} AppState */
/**
 * @typedef {{
 *   wrap: HTMLElement,
 *   button: HTMLButtonElement,
 *   menu: HTMLElement,
 * }} ExportElements
 */
/**
 * @typedef {{
 *   state: AppState,
 *   els: ExportElements,
 *   showToast(message: string): void,
 * }} ExportOptions
 */

/**
 * @param {string} contents
 * @param {string} type
 * @param {string} filename
 */
function downloadBlob(contents, type, filename) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** @param {ExportOptions} options */
export function createExportController({ state, els, showToast }) {
  function closeMenu(restoreFocus = false) {
    if (els.menu.hidden) return;
    els.menu.hidden = true;
    els.button.setAttribute("aria-expanded", "false");
    if (restoreFocus) els.button.focus();
  }

  function openMenu() {
    if (els.button.disabled) return;
    const csvButton = /** @type {HTMLButtonElement | null} */ (els.menu.querySelector('[data-export="csv"]'));
    if (csvButton) csvButton.disabled = state.view.length === 0;
    els.menu.hidden = false;
    els.button.setAttribute("aria-expanded", "true");
  }

  function toggleMenu() {
    if (els.menu.hidden) openMenu();
    else closeMenu();
  }

  function exportCSV() {
    const date = new Date().toISOString().slice(0, 10);
    downloadBlob(buildLikesCSV(state.view), "text/csv;charset=utf-8", `x-likes-results-${date}.csv`);
    showToast(`Exported ${state.view.length} results as CSV`);
  }

  function exportJSON() {
    const date = new Date().toISOString().slice(0, 10);
    downloadBlob(
      JSON.stringify(state.rawLikes, null, 2),
      "application/json",
      `x-likes-${date}.json`
    );
    showToast("Exported raw JSON data");
  }

  /**
   * @param {GalleryPhotoItem[]} items
   * @returns {Promise<{ started: number, failed: GalleryPhotoItem[] }>}
   */
  async function downloadPhotos(items) {
    let started = 0;
    /** @type {GalleryPhotoItem[]} */
    const failed = [];
    for (const item of items) {
      const download = photoDownload(item);
      try {
        await chrome.downloads.download({
          url: download.url,
          filename: download.filename,
          conflictAction: "uniquify",
          saveAs: false,
        });
        started += 1;
      } catch (_) {
        failed.push(item);
      }
    }
    if (failed.length) showToast(`Started ${started} downloads · ${failed.length} failed`);
    else showToast(`Started ${started} photo ${started === 1 ? "download" : "downloads"}`);
    return { started, failed };
  }

  /** @param {boolean} disabled */
  function setDisabled(disabled) {
    els.button.disabled = disabled;
    if (disabled) closeMenu();
  }

  els.button.addEventListener("click", toggleMenu);
  els.button.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    openMenu();
    const first = /** @type {HTMLButtonElement | null} */ (els.menu.querySelector("button:not(:disabled)"));
    first?.focus();
  });
  els.menu.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("button[data-export]") : null;
    if (!(button instanceof HTMLButtonElement) || button.disabled) return;
    if (button.dataset.export === "csv") exportCSV();
    else if (button.dataset.export === "json") exportJSON();
    closeMenu(true);
  });
  els.menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...els.menu.querySelectorAll("button:not(:disabled)")];
    const current = document.activeElement ? items.indexOf(document.activeElement) : -1;
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const next = (current + delta + items.length) % items.length;
    if (items[next] instanceof HTMLElement) items[next].focus();
  });
  document.addEventListener("pointerdown", (event) => {
    if (event.target instanceof Node && !els.wrap.contains(event.target)) closeMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || els.menu.hidden) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeMenu(true);
  });

  return { closeMenu, downloadPhotos, setDisabled };
}
