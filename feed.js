import { INDEX_VERSION } from "./core/constants.js";
import { escapeHTML } from "./core/format.js";
import { addHistory, countMatches, removeHistory } from "./core/search.js";
import { createPhotosController } from "./feed/photos.js";
import { createPostsController } from "./feed/posts.js";
import {
  appState,
  applyIndexModel,
  getCachedBase,
  invalidatePipelineCache,
  rebuildView,
} from "./feed/state.js";
import { createSyncController } from "./feed/sync.js";

const HISTORY_KEY = "finder-history";
const THEME_KEY = "finder-theme";
const RENDER_DEBOUNCE_MS = 200;

/** @param {string} selector */
const $ = (selector) => /** @type {HTMLElement} */ (document.querySelector(selector));

const els = {
  q: /** @type {HTMLInputElement} */ ($("#q")),
  feedScroll: $("#feed-scroll"),
  results: $("#results"),
  gallery: $("#gallery"),
  empty: $("#empty"),
  count: $("#mc"),
  status: $("#sb-status"),
  history: $("#history"),
  sort: $("#sort"),
  viewMode: $("#view-mode"),
  theme: $("#theme-btn"),
  toast: $("#toast"),
  toastText: $("#toast-txt"),
  lightbox: $("#lightbox"),
  lightboxImage: /** @type {HTMLImageElement} */ ($("#lb-image")),
  lightboxError: $("#lb-error"),
  lightboxAuthor: $("#lb-author"),
  lightboxHandle: $("#lb-handle"),
  lightboxCount: $("#lb-count"),
};

const SUN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/></svg>';
const MOON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 13A8.5 8.5 0 1 1 11 3a6.5 6.5 0 0 0 10 10z"/></svg>';

/** @type {ReturnType<typeof setTimeout> | null} */
let toastTimer = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let historyTimer = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let renderTimer = null;
let renderGeneration = 0;

function appNow() {
  return window.__XLS_NOW ? new Date(window.__XLS_NOW) : new Date();
}

/** @returns {string[]} */
function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

/** @param {string[]} items */
function setHistory(items) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
}

/** @param {string} query */
function pushHistory(query) {
  setHistory(addHistory(getHistory(), query));
}

function renderHistory() {
  const items = getHistory();
  if (!items.length) {
    els.history.innerHTML = "";
    return;
  }
  els.history.innerHTML =
    '<div class="h-lbl">recent searches<span class="clr" id="h-clear">clear</span></div>' +
    items.map((query) => `<div class="h-item" data-q="${escapeHTML(query)}">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/></svg>
      <span>${escapeHTML(query)}</span><span class="x" data-del="${escapeHTML(query)}">✕</span>
    </div>`).join("");
}

function maybeShowHistory() {
  if (document.activeElement === els.q && !els.q.value.trim() && getHistory().length) {
    renderHistory();
    els.history.classList.add("show");
  } else {
    els.history.classList.remove("show");
  }
}

/** @param {"light" | "dark"} theme */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  els.theme.innerHTML = theme === "dark" ? MOON : SUN;
  localStorage.setItem(THEME_KEY, theme);
  try {
    chrome.storage.local.set({ [THEME_KEY]: theme });
  } catch (_) {}
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved === "light" ? "light" : "dark");
}

function updateSyncButtons() {
  const syncButton = $("#open-likes");
  const exportButton = $("#export");
  const empty = appState.allLikes.length === 0;
  /**
   * @param {string} selector
   * @param {boolean} hidden
   */
  const setHidden = (selector, hidden) => {
    const element = $(selector);
    if (element) element.style.display = hidden ? "none" : "";
  };
  setHidden("#export", empty);
  setHidden(".filters", empty);
  if (syncButton) {
    syncButton.textContent = appState.syncState.running ? "stop" : "sync";
    /** @type {HTMLButtonElement} */ (syncButton).disabled = false;
    syncButton.title = appState.syncState.running ? "Stop sync" : "Sync likes";
  }
  if (exportButton) {
    /** @type {HTMLButtonElement} */ (exportButton).disabled = Boolean(appState.syncState.running);
    exportButton.title = appState.syncState.running
      ? "Wait until sync finishes"
      : "Export indexed likes as JSON";
  }
}

function updateStatus() {
  const localCount = appState.mode === "photos"
    ? `${photos.hasItems ? photos.itemCount : 0} photos from ${photos.likeCount} likes`
    : `${appState.allLikes.length} liked`;
  if (appState.syncState.running) {
    els.status.textContent = `Syncing… ${appState.syncState.message || "Preparing request…"}`;
  } else if (appState.syncState.error) {
    els.status.textContent = appState.syncState.error;
  } else if (appState.syncState.done && appState.syncState.message) {
    els.status.textContent = `${localCount} · ${appState.syncState.message}`;
  } else {
    els.status.textContent = `${localCount} · local only`;
  }
  els.status.closest(".sb-status")?.classList.toggle("is-syncing", Boolean(appState.syncState.running));
  updateSyncButtons();
  sync.scheduleReconcile();
}

function updateCount() {
  if (!appState.q) {
    els.count.textContent = "";
    els.count.style.display = "none";
    return;
  }
  if (appState.mode === "photos") {
    els.count.innerHTML = `<b>${photos.itemCount}</b> photos in ${appState.view.length} likes`;
  } else {
    const index = appState.active >= 0 ? appState.active + 1 : 0;
    els.count.innerHTML = `<b>${index}</b> / ${appState.view.length} in ${appState.allLikes.length}`;
  }
  els.count.style.display = "";
}

function updateMatchCountPreview() {
  if (!appState.q) {
    els.count.textContent = "";
    els.count.style.display = "none";
    return;
  }
  const matches = countMatches(getCachedBase(), appState.q);
  els.count.innerHTML = `<b>…</b> / ${matches} in ${appState.allLikes.length}`;
  els.count.style.display = "";
}

/** @param {string} message */
function showToast(message) {
  els.toastText.textContent = message;
  els.toast.classList.add("show");
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 1600);
}

/** @param {import("./core/likes.js").LikeView | import("./core/likes.js").MediaSourceView} tweet */
function openTweet(tweet) {
  if (!tweet?.url) return;
  pushHistory(appState.q);
  chrome.tabs.create({ url: tweet.url, active: true });
}

/**
 * @param {import("./core/likes.js").LikeView} tweet
 * @param {HTMLElement} button
 */
function copyLink(tweet, button) {
  const done = () => {
    button.classList.add("ok");
    button.textContent = "✓ copied";
    showToast("Link copied to clipboard");
    setTimeout(() => {
      button.classList.remove("ok");
      button.textContent = "⧉ copy link";
    }, 1400);
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(tweet.url).then(done, done);
  else done();
}

function renderEmptyState() {
  els.results.style.display = "none";
  els.gallery.hidden = true;
  if (appState.mode === "photos") {
    photos.clear();
    if (Number(appState.indexState.indexVersion || 0) < INDEX_VERSION) {
      els.empty.innerHTML = '<div class="empty"><div class="big">Photos need indexing</div><p>Run sync once to add photos to your existing likes.</p></div>';
    } else if (appState.q) {
      els.empty.innerHTML = `<div class="empty"><div class="big">No matching photos</div><p>No liked photos match <span class="q">"${escapeHTML(appState.q)}"</span></p></div>`;
    } else {
      els.empty.innerHTML = '<div class="empty"><div class="big">No liked photos</div><p>Your indexed likes do not contain photos yet.</p></div>';
    }
    return;
  }
  posts.clear();
  if (appState.allLikes.length) {
    els.empty.innerHTML = `<div class="empty"><div class="big">No matches</div><p>Nothing liked matches <span class="q">"${escapeHTML(appState.q)}"</span></p></div>`;
  } else {
    els.empty.innerHTML = `
      <div class="empty">
        <div class="big">No likes indexed yet</div>
        <div class="steps-guide">
          <div class="step"><div class="n">1</div><div><div class="sb">Open your X likes page</div><div class="ss">Go to <a href="https://x.com/i/history/likes" target="_blank" rel="noreferrer">History → Likes</a> and let the page load.</div></div></div>
          <div class="step"><div class="n">2</div><div><div class="sb">Sync from here</div><div class="ss">Return to this tab and click <b>sync</b> in the top-right corner.</div></div></div>
        </div>
      </div>`;
  }
}

function renderCurrentMode(resetScroll = true) {
  rebuildView();
  photos.rebuild();
  document.body.dataset.mode = appState.mode;
  updateStatus();
  updateCount();
  const rendered = appState.mode === "photos"
    ? photos.render(resetScroll)
    : posts.render(resetScroll);
  if (!rendered) renderEmptyState();
}

function scheduleRender(resetScroll = true) {
  const generation = ++renderGeneration;
  if (renderTimer !== null) clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    if (generation === renderGeneration) renderCurrentMode(resetScroll);
  }, RENDER_DEBOUNCE_MS);
}

/**
 * @param {import("./core/likes.js").LikeIndex} index
 * @param {boolean} [resetScroll]
 */
function applyIndex(index, resetScroll = true) {
  applyIndexModel(index);
  renderCurrentMode(resetScroll);
}

function exportLikes() {
  const blob = new Blob([JSON.stringify(appState.rawLikes, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `x-likes-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const posts = createPostsController({
  state: appState,
  els,
  appNow,
  updateCount,
  openTweet,
  copyLink,
});
const photos = createPhotosController({ state: appState, els, appNow, openTweet });
const sync = createSyncController({
  state: appState,
  showToast,
  updateStatus,
  applyIndex,
  renderCurrentMode,
});

function wireEvents() {
  els.theme.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    applyTheme(current === "dark" ? "light" : "dark");
  });

  els.q.addEventListener("input", () => {
    appState.q = els.q.value.trim();
    appState.active = -1;
    updateMatchCountPreview();
    scheduleRender(true);
    maybeShowHistory();
    if (historyTimer !== null) clearTimeout(historyTimer);
    historyTimer = setTimeout(() => {
      if (appState.q.length >= 2 && appState.view.length) pushHistory(appState.q);
    }, 1100);
  });
  els.q.addEventListener("focus", maybeShowHistory);
  els.q.addEventListener("blur", () => setTimeout(() => els.history.classList.remove("show"), 150));

  els.history.addEventListener("mousedown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const removeButton = target.closest("[data-del]");
    if (removeButton) {
      event.preventDefault();
      setHistory(removeHistory(getHistory(), removeButton.getAttribute("data-del") || ""));
      renderHistory();
      return;
    }
    if (target.id === "h-clear") {
      event.preventDefault();
      setHistory([]);
      maybeShowHistory();
      return;
    }
    const item = target.closest(".h-item");
    if (!item) return;
    event.preventDefault();
    els.q.value = item.getAttribute("data-q") || "";
    appState.q = els.q.value;
    appState.active = -1;
    els.history.classList.remove("show");
    updateMatchCountPreview();
    renderCurrentMode(true);
    els.q.focus();
  });

  document.addEventListener("keydown", (event) => {
    if (photos.isOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        photos.close();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        photos.move(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        photos.move(1);
      }
      return;
    }
    if (event.key === "/" && document.activeElement !== els.q) {
      event.preventDefault();
      els.q.focus();
      els.q.select();
      return;
    }
    if (event.key === "Escape") {
      els.history.classList.remove("show");
      if (!els.q.value) return;
      event.preventDefault();
      els.q.value = "";
      appState.q = "";
      appState.active = -1;
      updateMatchCountPreview();
      renderCurrentMode(true);
      return;
    }
    if (event.key === "ArrowDown" && appState.mode === "posts") {
      event.preventDefault();
      posts.move(1);
    } else if (event.key === "ArrowUp" && appState.mode === "posts") {
      event.preventDefault();
      posts.move(-1);
    } else if (event.key === "Enter" && appState.mode === "posts") {
      if ((event.metaKey || event.ctrlKey) && appState.active >= 0) {
        openTweet(appState.view[appState.active]);
      } else {
        event.preventDefault();
        posts.move(1);
      }
    }
  });

  els.sort.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (!button) return;
    const sort = button.dataset.sort;
    if (sort !== "newest" && sort !== "oldest" && sort !== "author") return;
    appState.sort = sort;
    [...els.sort.children].forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    invalidatePipelineCache();
    renderCurrentMode(true);
  });

  els.viewMode.addEventListener("click", (event) => {
    const button = event.target instanceof Element
      ? event.target.closest("button[data-mode]")
      : null;
    if (!button) return;
    const mode = /** @type {HTMLElement} */ (button).dataset.mode;
    if ((mode !== "posts" && mode !== "photos") || mode === appState.mode) return;
    appState.mode = mode;
    appState.active = -1;
    [...els.viewMode.children].forEach((item) =>
      item.setAttribute("aria-pressed", String(item === button))
    );
    photos.close();
    renderCurrentMode(true);
  });

  els.feedScroll.addEventListener("scroll", () => {
    if (appState.mode === "photos") photos.onScroll();
    else posts.schedulePaint();
  });
  $("#open-likes").addEventListener("click", sync.toggle);
  $("#export").addEventListener("click", exportLikes);
  chrome.storage.onChanged.addListener(sync.onStorageChanged);
  window.addEventListener("pagehide", sync.dispose);
}

initTheme();
wireEvents();
sync.loadIndex();
sync.loadIndexState();
sync.refresh();

window.__feedApp = {
  state: appState,
  get allLikes() { return appState.allLikes; },
  get view() { return appState.view; },
  load: sync.loadIndex,
  render: renderCurrentMode,
  RENDER_DEBOUNCE_MS,
  INDEX_REFRESH_MS: sync.INDEX_REFRESH_MS,
  SYNC_RECONCILE_MS: sync.SYNC_RECONCILE_MS,
  GALLERY_BATCH_SIZE: photos.GALLERY_BATCH_SIZE,
};
