import { escapeHTML, relativeDate } from "../core/format.js";
import { flattenPhotoItems, mediaUrl } from "../core/likes.js";

const GALLERY_BATCH_SIZE = 60;

/** @typedef {import("../core/likes.js").GalleryPhotoItem} GalleryPhotoItem */
/** @typedef {import("../core/likes.js").LikeView | import("../core/likes.js").MediaSourceView} OpenableTweet */
/** @typedef {typeof import("./state.js").appState} AppState */
/**
 * @typedef {{
 *   feedScroll: HTMLElement,
 *   results: HTMLElement,
 *   gallery: HTMLElement,
 *   empty: HTMLElement,
 *   lightbox: HTMLElement,
 *   lightboxImage: HTMLImageElement,
 *   lightboxAuthor: HTMLElement,
 *   lightboxHandle: HTMLElement,
 *   lightboxCount: HTMLElement,
 *   lightboxDownload: HTMLButtonElement,
 *   photoActions: HTMLElement,
 *   photoSelect: HTMLButtonElement,
 *   photoSelection: HTMLElement,
 *   photoSelectedCount: HTMLElement,
 *   photoDownload: HTMLButtonElement,
 *   photoCancel: HTMLButtonElement,
 * }} PhotosElements
 */
/**
 * @typedef {{
 *   state: AppState,
 *   els: PhotosElements,
 *   appNow(): Date,
 *   openTweet(tweet: OpenableTweet): void,
 *   downloadPhotos(items: GalleryPhotoItem[]): Promise<{ started: number, failed: GalleryPhotoItem[] }>,
 * }} PhotosOptions
 */

/** @param {PhotosOptions} options */
export function createPhotosController({ state, els, appNow, openTweet, downloadPhotos }) {
  /** @type {GalleryPhotoItem[]} */
  let galleryItems = [];
  let galleryRendered = 0;
  let lightboxIndex = -1;
  let lightboxDownloading = false;
  let selecting = false;
  let downloading = false;
  let selectionGeneration = 0;
  /** @type {Set<string>} */
  let selectedKeys = new Set();
  /** @type {Element | null} */
  let lightboxReturnFocus = null;

  /** @param {GalleryPhotoItem} item */
  function itemKey(item) {
    return `${item.likedTweet.tweetId}:${item.mediaIndex}`;
  }

  /**
   * @param {GalleryPhotoItem} item
   * @param {number} index
   */
  function galleryCardHTML(item, index) {
    const alt = item.media.altText || `Photo by ${item.tweet.author.name}`;
    const selected = selectedKeys.has(itemKey(item));
    const selectionClass = selecting ? ` is-selecting${selected ? " is-selected" : ""}` : "";
    const pressed = selecting ? ` aria-pressed="${selected}"` : "";
    return `<button class="gallery-card${selectionClass}" data-gallery-i="${index}" aria-label="${escapeHTML(alt)}"${pressed}>
      <img src="${escapeHTML(mediaUrl(item.media.url, "small"))}" alt="${escapeHTML(alt)}" loading="lazy" referrerpolicy="no-referrer" />
      <span class="gallery-placeholder">image unavailable</span>
      <span class="gallery-check" aria-hidden="true">✓</span>
      <span class="gallery-meta">
        <strong>${escapeHTML(item.tweet.author.name)}</strong>
        <span>${escapeHTML(relativeDate(item.tweet.date, appNow()))}</span>
      </span>
    </button>`;
  }

  function appendBatch() {
    if (galleryRendered >= galleryItems.length) return;
    const end = Math.min(galleryRendered + GALLERY_BATCH_SIZE, galleryItems.length);
    const parts = [];
    for (let i = galleryRendered; i < end; i += 1) parts.push(galleryCardHTML(galleryItems[i], i));
    els.gallery.insertAdjacentHTML("beforeend", parts.join(""));
    galleryRendered = end;
  }

  function updateSelectionControls() {
    const count = selectedKeys.size;
    els.photoActions.hidden = state.mode !== "photos" || !galleryItems.length;
    els.photoSelect.hidden = selecting;
    els.photoSelection.hidden = !selecting;
    els.photoSelectedCount.textContent = `${count} selected`;
    els.photoDownload.disabled = count === 0 || downloading;
    els.photoDownload.textContent = downloading ? "downloading…" : "download";
  }

  function updateRenderedSelection() {
    els.gallery.classList.toggle("is-selecting", selecting);
    els.gallery.querySelectorAll("[data-gallery-i]").forEach((card) => {
      const index = Number(/** @type {HTMLElement} */ (card).dataset.galleryI);
      const item = galleryItems[index];
      const selected = Boolean(item && selectedKeys.has(itemKey(item)));
      card.classList.toggle("is-selecting", selecting);
      card.classList.toggle("is-selected", selecting && selected);
      if (selecting) card.setAttribute("aria-pressed", String(selected));
      else card.removeAttribute("aria-pressed");
    });
    updateSelectionControls();
  }

  function startSelection() {
    if (!galleryItems.length) return;
    selectionGeneration += 1;
    selecting = true;
    selectedKeys.clear();
    updateRenderedSelection();
  }

  function cancelSelection() {
    selectionGeneration += 1;
    selecting = false;
    downloading = false;
    selectedKeys.clear();
    updateRenderedSelection();
  }

  /** @param {number} index */
  function toggleSelection(index) {
    const item = galleryItems[index];
    if (!item || downloading) return;
    const key = itemKey(item);
    if (selectedKeys.has(key)) selectedKeys.delete(key);
    else selectedKeys.add(key);
    updateRenderedSelection();
  }

  async function downloadSelection() {
    if (downloading || !selectedKeys.size) return;
    const items = galleryItems.filter((item) => selectedKeys.has(itemKey(item)));
    const generation = selectionGeneration;
    downloading = true;
    updateSelectionControls();
    const result = await downloadPhotos(items);
    if (generation !== selectionGeneration) return;
    downloading = false;
    if (result.failed.length) {
      selectedKeys = new Set(result.failed.map(itemKey));
    } else {
      selecting = false;
      selectedKeys.clear();
    }
    updateRenderedSelection();
  }

  function renderLightbox() {
    const item = galleryItems[lightboxIndex];
    if (!item) {
      close();
      return;
    }
    els.lightbox.querySelector(".lb-stage")?.classList.remove("is-error");
    els.lightboxImage.alt = item.media.altText || `Photo by ${item.tweet.author.name}`;
    els.lightboxImage.src = mediaUrl(item.media.url, "large");
    els.lightboxAuthor.textContent = item.tweet.author.name;
    els.lightboxHandle.textContent = item.tweet.author.handle ? `@${item.tweet.author.handle}` : "";
    els.lightboxCount.textContent = `${lightboxIndex + 1} / ${galleryItems.length}`;
  }

  async function downloadLightboxPhoto() {
    if (lightboxDownloading) return;
    const item = galleryItems[lightboxIndex];
    if (!item) return;
    lightboxDownloading = true;
    els.lightboxDownload.disabled = true;
    els.lightboxDownload.setAttribute("aria-label", "Downloading photo");
    els.lightboxDownload.title = "Downloading photo";
    try {
      await downloadPhotos([item]);
    } finally {
      lightboxDownloading = false;
      els.lightboxDownload.disabled = false;
      els.lightboxDownload.setAttribute("aria-label", "Download photo");
      els.lightboxDownload.title = "Download photo";
    }
  }

  /** @param {number} index */
  function open(index) {
    if (!galleryItems[index]) return;
    lightboxReturnFocus = document.activeElement;
    lightboxIndex = index;
    els.lightbox.hidden = false;
    renderLightbox();
    const closeButton = els.lightbox.querySelector(".lb-close");
    if (closeButton instanceof HTMLElement) closeButton.focus();
  }

  function close() {
    if (els.lightbox.contains(document.activeElement)) {
      if (lightboxReturnFocus instanceof HTMLElement && lightboxReturnFocus.isConnected) {
        lightboxReturnFocus.focus();
      } else if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    }
    lightboxIndex = -1;
    els.lightbox.hidden = true;
    els.lightboxImage.removeAttribute("src");
    lightboxReturnFocus = null;
  }

  /** @param {number} delta */
  function move(delta) {
    if (lightboxIndex < 0 || !galleryItems.length) return;
    lightboxIndex = (lightboxIndex + delta + galleryItems.length) % galleryItems.length;
    renderLightbox();
  }

  function rebuild() {
    galleryItems = state.mode === "photos" ? flattenPhotoItems(state.view) : [];
    if (lightboxIndex >= galleryItems.length) close();
    updateSelectionControls();
  }

  /** @param {boolean} resetScroll */
  function render(resetScroll) {
    els.results.style.display = "none";
    if (!galleryItems.length) return false;
    els.empty.innerHTML = "";
    els.gallery.hidden = false;
    els.gallery.innerHTML = "";
    galleryRendered = 0;
    appendBatch();
    updateRenderedSelection();
    if (resetScroll) els.feedScroll.scrollTop = els.gallery.offsetTop;
    return true;
  }

  function clear() {
    els.gallery.innerHTML = "";
    galleryRendered = 0;
    updateSelectionControls();
  }

  function onScroll() {
    const remaining = els.feedScroll.scrollHeight - els.feedScroll.scrollTop - els.feedScroll.clientHeight;
    if (remaining < 500) appendBatch();
  }

  function wireEvents() {
    els.gallery.addEventListener("error", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.tagName === "IMG") {
        target.closest(".gallery-card")?.classList.add("is-error");
      }
    }, true);
    els.gallery.addEventListener("click", (event) => {
      const card = event.target instanceof Element
        ? event.target.closest("[data-gallery-i]")
        : null;
      if (!card) return;
      const index = Number(/** @type {HTMLElement} */ (card).dataset.galleryI);
      if (selecting) toggleSelection(index);
      else open(index);
    });
    els.lightbox.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      if (target.closest("[data-lightbox-close]")) {
        close();
        return;
      }
      const control = target.closest("[data-lightbox-move]");
      if (control) move(Number(/** @type {HTMLElement} */ (control).dataset.lightboxMove));
    });
    els.lightboxImage.addEventListener("error", () => {
      els.lightbox.querySelector(".lb-stage")?.classList.add("is-error");
    });
    /** @type {HTMLElement} */ (document.querySelector("#lb-open")).addEventListener("click", () => {
      const item = galleryItems[lightboxIndex];
      if (item) openTweet(item.tweet);
    });
    els.lightboxDownload.addEventListener("click", () => { void downloadLightboxPhoto(); });
    els.photoSelect.addEventListener("click", startSelection);
    els.photoCancel.addEventListener("click", cancelSelection);
    els.photoDownload.addEventListener("click", downloadSelection);
  }

  wireEvents();

  return {
    GALLERY_BATCH_SIZE,
    cancelSelection,
    clear,
    close,
    get hasItems() { return galleryItems.length > 0; },
    get itemCount() { return galleryItems.length; },
    get likeCount() {
      return new Set(galleryItems.map((item) => item.likedTweet.tweetId)).size;
    },
    get isOpen() { return lightboxIndex >= 0; },
    move,
    onScroll,
    rebuild,
    render,
  };
}
