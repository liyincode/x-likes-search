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
 * }} PhotosElements
 */
/**
 * @typedef {{
 *   state: AppState,
 *   els: PhotosElements,
 *   appNow(): Date,
 *   openTweet(tweet: OpenableTweet): void,
 * }} PhotosOptions
 */

/** @param {PhotosOptions} options */
export function createPhotosController({ state, els, appNow, openTweet }) {
  /** @type {GalleryPhotoItem[]} */
  let galleryItems = [];
  let galleryRendered = 0;
  let lightboxIndex = -1;
  /** @type {Element | null} */
  let lightboxReturnFocus = null;

  /**
   * @param {GalleryPhotoItem} item
   * @param {number} index
   */
  function galleryCardHTML(item, index) {
    const alt = item.media.altText || `Photo by ${item.tweet.author.name}`;
    return `<button class="gallery-card" data-gallery-i="${index}" aria-label="${escapeHTML(alt)}">
      <img src="${escapeHTML(mediaUrl(item.media.url, "small"))}" alt="${escapeHTML(alt)}" loading="lazy" referrerpolicy="no-referrer" />
      <span class="gallery-placeholder">image unavailable</span>
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

  /** @param {number} index */
  function open(index) {
    if (!galleryItems[index]) return;
    lightboxReturnFocus = document.activeElement;
    lightboxIndex = index;
    els.lightbox.hidden = false;
    els.lightbox.setAttribute("aria-hidden", "false");
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
    els.lightbox.setAttribute("aria-hidden", "true");
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
    if (resetScroll) els.feedScroll.scrollTop = els.gallery.offsetTop;
    return true;
  }

  function clear() {
    els.gallery.innerHTML = "";
    galleryRendered = 0;
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
      if (card) open(Number(/** @type {HTMLElement} */ (card).dataset.galleryI));
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
  }

  wireEvents();

  return {
    GALLERY_BATCH_SIZE,
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
