import { avatarColors, escapeHTML, fullDate, initials, relativeDate } from "../core/format.js";
import { highlight } from "../core/search.js";
import {
  buildRowOffsets,
  ROW_ACTIVE_EXPANDED,
  ROW_COLLAPSED,
  visibleRange,
} from "../core/virtual-list.js";

/** @typedef {import("../core/likes.js").LikeView} LikeView */
/** @typedef {typeof import("./state.js").appState} AppState */
/**
 * @typedef {{
 *   feedScroll: HTMLElement,
 *   results: HTMLElement,
 *   gallery: HTMLElement,
 *   empty: HTMLElement,
 * }} PostsElements
 */
/**
 * @typedef {{
 *   state: AppState,
 *   els: PostsElements,
 *   appNow(): Date,
 *   updateCount(): void,
 *   openTweet(tweet: LikeView): void,
 *   copyLink(tweet: LikeView, button: HTMLElement): void,
 * }} PostsOptions
 */

/** @param {PostsOptions} options */
export function createPostsController({ state, els, appNow, updateCount, openTweet, copyLink }) {
  let paintRaf = 0;
  /** @type {import("../core/virtual-list.js").RowLayout} */
  let rowLayout = { tops: [], heights: [], totalHeight: 0 };
  /** @type {HTMLElement | null} */
  let virtualSpacer = null;
  /** @type {HTMLElement | null} */
  let virtualWindow = null;
  let resultsWired = false;
  let activeRowHeight = ROW_ACTIVE_EXPANDED;
  /** @type {string | null} */
  let activeRowHeightId = null;

  /** @param {LikeView} tweet */
  function avatarHTML(tweet) {
    const colors = avatarColors(tweet.author.hue);
    const fallback = `<span class="av-fallback">${initials(tweet.author.name)}</span>`;
    const image = tweet.author.avatar
      ? `<img src="${escapeHTML(tweet.author.avatar)}" alt="" referrerpolicy="no-referrer" />`
      : "";
    return `<div class="av" style="background:linear-gradient(135deg, ${colors.bg}, ${colors.bg2})">${image}${fallback}</div>`;
  }

  /**
   * @param {LikeView} tweet
   * @param {number} index
   */
  function rowHTML(tweet, index) {
    const stats = tweet.stats
      ? `<span class="stats">${Number.isFinite(tweet.stats.likes) ? `<span>♡ ${tweet.stats.likes}</span>` : ""}${Number.isFinite(tweet.stats.reposts) ? `<span>⇄ ${tweet.stats.reposts}</span>` : ""}</span>`
      : "";
    const active = index === state.active ? " active" : "";
    return `
      <div class="row${active}" data-i="${index}" data-id="${escapeHTML(tweet.tweetId)}">
        ${avatarHTML(tweet)}
        <div class="meta">
          <div class="line1">
            <span class="nm">${highlight(tweet.author.name, state.q)}</span>
            <span class="hd">@${highlight(tweet.author.handle, state.q)}</span>
          </div>
          <div class="snip">${highlight(tweet.text, state.q) || '<span style="opacity:.55">(no text — link only)</span>'}</div>
          <div class="expand">
            <div class="row-actions">
              ${stats}
              <span style="flex:1"></span>
              <button class="mini copy-btn">⧉ copy link</button>
              <button class="mini primary open-btn">open on X ↗</button>
            </div>
          </div>
        </div>
        <div class="when" title="${escapeHTML(fullDate(tweet.date))}">${relativeDate(tweet.date, appNow())}</div>
      </div>`;
  }

  function ensureVirtualDOM() {
    if (virtualSpacer && virtualWindow && els.results.contains(virtualSpacer)) return;
    els.results.innerHTML =
      '<div class="virtual-spacer" aria-hidden="true"></div><div class="virtual-window"></div>';
    virtualSpacer = /** @type {HTMLElement} */ (els.results.querySelector(".virtual-spacer"));
    virtualWindow = /** @type {HTMLElement} */ (els.results.querySelector(".virtual-window"));
    wireResultsEvents();
  }

  function wireResultsEvents() {
    if (resultsWired) return;
    resultsWired = true;
    els.results.addEventListener("error", (event) => {
      if (event.target instanceof Element && event.target.tagName === "IMG") event.target.remove();
    }, true);
    els.results.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const openButton = target.closest(".open-btn");
      if (openButton) {
        event.stopPropagation();
        const row = openButton.closest(".row");
        if (row) openTweet(state.view[Number(/** @type {HTMLElement} */ (row).dataset.i)]);
        return;
      }
      const copyButton = target.closest(".copy-btn");
      if (copyButton) {
        event.stopPropagation();
        const row = copyButton.closest(".row");
        if (row && copyButton instanceof HTMLElement) {
          copyLink(state.view[Number(/** @type {HTMLElement} */ (row).dataset.i)], copyButton);
        }
        return;
      }
      const row = target.closest(".row");
      if (row) toggleActive(Number(/** @type {HTMLElement} */ (row).dataset.i));
    });
    els.results.addEventListener("dblclick", (event) => {
      const row = event.target instanceof Element ? event.target.closest(".row") : null;
      if (row) openTweet(state.view[Number(/** @type {HTMLElement} */ (row).dataset.i)]);
    });
  }

  function syncActiveRowHeightIdentity() {
    const id = state.active >= 0 ? state.view[state.active]?.tweetId || String(state.active) : null;
    if (id !== activeRowHeightId) {
      activeRowHeightId = id;
      activeRowHeight = ROW_ACTIVE_EXPANDED;
    }
  }

  function measureActiveRowHeight() {
    const row = virtualWindow?.querySelector(".row.active");
    if (!row) return false;
    const measured = Math.max(ROW_ACTIVE_EXPANDED, Math.ceil(row.getBoundingClientRect().height));
    if (Math.abs(measured - activeRowHeight) <= 1) return false;
    activeRowHeight = measured;
    return true;
  }

  function rebuildRowLayout() {
    syncActiveRowHeightIdentity();
    rowLayout = buildRowOffsets(state.view.length, state.active, ROW_COLLAPSED, activeRowHeight);
    if (virtualSpacer) virtualSpacer.style.height = `${rowLayout.totalHeight}px`;
  }

  function listViewport() {
    if (!els.feedScroll || !els.results) return { scrollTop: 0, vh: 400 };
    const scrollRect = els.feedScroll.getBoundingClientRect();
    const resultsRect = els.results.getBoundingClientRect();
    const scrollTop = Math.max(0, els.feedScroll.scrollTop - els.results.offsetTop);
    const top = Math.max(resultsRect.top, scrollRect.top);
    const bottom = Math.min(resultsRect.bottom, scrollRect.bottom);
    return { scrollTop, vh: Math.max(120, bottom - top) };
  }

  /** @param {boolean} resetScroll */
  function paint(resetScroll) {
    if (state.mode !== "posts" || !state.view.length || !virtualWindow) return;
    rebuildRowLayout();
    if (resetScroll) els.feedScroll.scrollTop = els.results.offsetTop;
    const { scrollTop, vh } = listViewport();
    const { start, end } = visibleRange(scrollTop, vh, rowLayout);
    if (end < start) {
      virtualWindow.innerHTML = "";
      virtualWindow.style.transform = "translateY(0)";
      return;
    }
    const parts = [];
    for (let i = start; i <= end; i += 1) parts.push(rowHTML(state.view[i], i));
    virtualWindow.style.transform = `translateY(${rowLayout.tops[start]}px)`;
    virtualWindow.innerHTML = parts.join("");
    if (measureActiveRowHeight()) rebuildRowLayout();
  }

  function scrollToActive() {
    if (state.active < 0 || !state.view.length) return;
    const rowTop = rowLayout.tops[state.active];
    const rowHeight = rowLayout.heights[state.active];
    const resultsTop = els.results.offsetTop;
    const { scrollTop: listTop, vh } = listViewport();
    const margin = 80;
    if (rowTop < listTop + margin) {
      els.feedScroll.scrollTop = Math.max(0, resultsTop + rowTop - margin);
    } else if (rowTop + rowHeight > listTop + vh - margin) {
      els.feedScroll.scrollTop = resultsTop + rowTop + rowHeight - vh + margin;
    }
  }

  /**
   * @param {number} index
   * @param {boolean} scroll
   */
  function setActive(index, scroll) {
    if (state.mode !== "posts") return;
    state.active = index;
    if (!state.view.length) return;
    paint(false);
    updateCount();
    if (scroll) scrollToActive();
  }

  /** @param {number} index */
  function toggleActive(index) {
    setActive(state.active === index ? -1 : index, false);
  }

  /** @param {number} delta */
  function move(delta) {
    if (state.mode !== "posts" || !state.view.length) return;
    let index = state.active < 0 ? 0 : state.active + delta;
    if (index < 0) index = state.view.length - 1;
    if (index >= state.view.length) index = 0;
    setActive(index, true);
  }

  /** @param {boolean} resetScroll */
  function render(resetScroll) {
    els.gallery.hidden = true;
    if (!state.view.length) return false;
    els.empty.innerHTML = "";
    els.results.style.display = "";
    ensureVirtualDOM();
    paint(resetScroll);
    return true;
  }

  function clear() {
    els.results.innerHTML = "";
    virtualSpacer = null;
    virtualWindow = null;
  }

  function schedulePaint() {
    if (state.mode !== "posts") return;
    cancelAnimationFrame(paintRaf);
    paintRaf = requestAnimationFrame(() => paint(false));
  }

  window.addEventListener("resize", schedulePaint);

  return { clear, move, render, schedulePaint };
}
