const STORAGE_KEY = "x_likes_index";
const STATE_KEY = "x_likes_state";
const SYNC_KEY = "x_likes_sync";
const HISTORY_KEY = "finder-history";
const THEME_KEY = "finder-theme";
const RENDER_DEBOUNCE_MS = 200;
const INDEX_REFRESH_MS = 2000;
const SYNC_RECONCILE_MS = 10000;
const GALLERY_BATCH_SIZE = 60;

const Core = window.FeedCore;
const $ = (s) => document.querySelector(s);

const els = {
  q: $("#q"),
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
  lightboxImage: $("#lb-image"),
  lightboxError: $("#lb-error"),
  lightboxAuthor: $("#lb-author"),
  lightboxHandle: $("#lb-handle"),
  lightboxCount: $("#lb-count"),
};

const state = { q: "", sort: "newest", mode: "posts", active: -1 };
let allLikes = [];
let view = [];
let rawLikes = [];
let indexState = {};
let galleryItems = [];
let galleryRendered = 0;
let lightboxIndex = -1;
let toastTimer = null;
let historyTimer = null;
let syncState = {};
let syncReconcileTimer = null;
let indexRefreshTimer = null;
let pendingIndex = null;
let hasPendingIndex = false;

let cachedBase = null;
let cachedPipelineKey = null;
let renderTimer = null;
let renderGen = 0;
let paintRaf = 0;
let rowLayout = { tops: [], heights: [], totalHeight: 0 };
let virtualSpacer = null;
let virtualWindow = null;
let resultsWired = false;
let activeRowHeight = Core.ROW_ACTIVE_EXPANDED;
let activeRowHeightId = null;

const SUN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/></svg>';
const MOON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 13A8.5 8.5 0 1 1 11 3a6.5 6.5 0 0 0 10 10z"/></svg>';

function appNow() {
  return window.__XLS_NOW ? new Date(window.__XLS_NOW) : new Date();
}

function pipelineCacheKey() {
  return state.sort;
}

function invalidatePipelineCache() {
  cachedPipelineKey = null;
  cachedBase = null;
}

function getCachedBase() {
  const key = pipelineCacheKey();
  if (cachedBase && cachedPipelineKey === key) return cachedBase;
  cachedPipelineKey = key;
  cachedBase = Core.pipeline(allLikes, state.sort);
  return cachedBase;
}

function getHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function setHistory(arr) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(arr));
}

function pushHistory(q) {
  setHistory(Core.addHistory(getHistory(), q));
}

function renderHistory() {
  const items = getHistory();
  if (!items.length) {
    els.history.innerHTML = "";
    return;
  }
  els.history.innerHTML =
    '<div class="h-lbl">recent searches<span class="clr" id="h-clear">clear</span></div>' +
    items
      .map(
        (q) => `<div class="h-item" data-q="${Core.escapeHTML(q)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 7v5l3 2"/><circle cx="12" cy="12" r="9"/></svg>
          <span>${Core.escapeHTML(q)}</span><span class="x" data-del="${Core.escapeHTML(q)}">✕</span>
        </div>`
      )
      .join("");
}

function maybeShowHistory() {
  if (document.activeElement === els.q && !els.q.value.trim() && getHistory().length) {
    renderHistory();
    els.history.classList.add("show");
  } else {
    els.history.classList.remove("show");
  }
}

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

function updateStatus() {
  const localCount =
    state.mode === "photos"
      ? `${galleryItems.length} photos from ${new Set(galleryItems.map((item) => item.likedTweet.tweetId)).size} likes`
      : `${allLikes.length} liked`;
  if (syncState.running) {
    els.status.textContent = `Syncing… ${allLikes.length} liked`;
  } else if (syncState.error) {
    els.status.textContent = syncState.error;
  } else if (syncState.done && syncState.message) {
    els.status.textContent = `${localCount} · ${syncState.message}`;
  } else {
    els.status.textContent = `${localCount} · local only`;
  }
  const sbStatus = els.status.closest(".sb-status");
  if (sbStatus) sbStatus.classList.toggle("is-syncing", Boolean(syncState.running));
  updateSyncButtons();
  scheduleSyncReconcile();
}

function updateSyncButtons() {
  const btn = $("#open-likes");
  const exportBtn = $("#export");
  const empty = allLikes.length === 0;
  const setHidden = (sel, hidden) => {
    const el = $(sel);
    if (el) el.style.display = hidden ? "none" : "";
  };
  setHidden("#export", empty);
  setHidden(".filters", empty);

  if (btn) {
    if (syncState.running) {
      btn.textContent = "stop";
      btn.disabled = false;
      btn.title = "Stop sync";
    } else {
      btn.textContent = "sync";
      btn.disabled = false;
      btn.title = "Sync likes";
    }
  }
  if (exportBtn) {
    exportBtn.disabled = Boolean(syncState.running);
    exportBtn.title = syncState.running ? "Wait until sync finishes" : "Export indexed likes as JSON";
  }
}

function updateCount(baseLen) {
  if (state.q) {
    if (state.mode === "photos") {
      els.count.innerHTML = `<b>${galleryItems.length}</b> photos in ${view.length} likes`;
      els.count.style.display = "";
      return;
    }
    const idx = state.active >= 0 ? state.active + 1 : 0;
    els.count.innerHTML = `<b>${idx}</b> / ${view.length} in ${allLikes.length}`;
    els.count.style.display = "";
  } else {
    els.count.textContent = "";
    els.count.style.display = "none";
  }
}

function updateMatchCountPreview() {
  if (!state.q) {
    els.count.textContent = "";
    els.count.style.display = "none";
    return;
  }
  const n = Core.countMatches(getCachedBase(), state.q);
  els.count.innerHTML = `<b>…</b> / ${n} in ${allLikes.length}`;
  els.count.style.display = "";
}

function avatarHTML(t) {
  const c = Core.avatarColors(t.author.hue);
  const fallback = `<span class="av-fallback">${Core.initials(t.author.name)}</span>`;
  const img = t.author.avatar
    ? `<img src="${Core.escapeHTML(t.author.avatar)}" alt="" referrerpolicy="no-referrer" />`
    : "";
  return `<div class="av" style="background:linear-gradient(135deg, ${c.bg}, ${c.bg2})">${img}${fallback}</div>`;
}

function rowHTML(t, i) {
  const stats = t.stats
    ? `<span class="stats">${Number.isFinite(t.stats.likes) ? `<span>♡ ${t.stats.likes}</span>` : ""}${Number.isFinite(t.stats.reposts) ? `<span>⇄ ${t.stats.reposts}</span>` : ""}</span>`
    : "";
  const active = i === state.active ? " active" : "";
  return `
    <div class="row${active}" data-i="${i}" data-id="${Core.escapeHTML(t.tweetId)}">
      ${avatarHTML(t)}
      <div class="meta">
        <div class="line1">
          <span class="nm">${Core.highlight(t.author.name, state.q)}</span>
          <span class="hd">@${Core.highlight(t.author.handle, state.q)}</span>
        </div>
        <div class="snip">${Core.highlight(t.text, state.q) || '<span style="opacity:.55">(no text — link only)</span>'}</div>
        <div class="expand">
          <div class="row-actions">
            ${stats}
            <span style="flex:1"></span>
            <button class="mini copy-btn">⧉ copy link</button>
            <button class="mini primary open-btn">open on X ↗</button>
          </div>
        </div>
      </div>
      <div class="when" title="${Core.escapeHTML(Core.fullDate(t.date))}">${Core.relativeDate(t.date, appNow())}</div>
    </div>`;
}

function galleryCardHTML(item, i) {
  const alt = item.media.altText || `Photo by ${item.tweet.author.name}`;
  return `<button class="gallery-card" data-gallery-i="${i}" aria-label="${Core.escapeHTML(alt)}">
    <img src="${Core.escapeHTML(Core.mediaUrl(item.media.url, "small"))}" alt="${Core.escapeHTML(alt)}" loading="lazy" referrerpolicy="no-referrer" />
    <span class="gallery-placeholder">image unavailable</span>
    <span class="gallery-meta">
      <strong>${Core.escapeHTML(item.tweet.author.name)}</strong>
      <span>${Core.escapeHTML(Core.relativeDate(item.tweet.date, appNow()))}</span>
    </span>
  </button>`;
}

function appendGalleryBatch() {
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
    closeLightbox();
    return;
  }
  els.lightbox.querySelector(".lb-stage").classList.remove("is-error");
  els.lightboxImage.alt = item.media.altText || `Photo by ${item.tweet.author.name}`;
  els.lightboxImage.src = Core.mediaUrl(item.media.url, "large");
  els.lightboxAuthor.textContent = item.tweet.author.name;
  els.lightboxHandle.textContent = item.tweet.author.handle ? `@${item.tweet.author.handle}` : "";
  els.lightboxCount.textContent = `${lightboxIndex + 1} / ${galleryItems.length}`;
}

function openLightbox(i) {
  if (!galleryItems[i]) return;
  lightboxIndex = i;
  els.lightbox.hidden = false;
  els.lightbox.setAttribute("aria-hidden", "false");
  renderLightbox();
  els.lightbox.querySelector(".lb-close").focus();
}

function closeLightbox() {
  lightboxIndex = -1;
  els.lightbox.hidden = true;
  els.lightbox.setAttribute("aria-hidden", "true");
  els.lightboxImage.removeAttribute("src");
}

function moveLightbox(delta) {
  if (lightboxIndex < 0 || !galleryItems.length) return;
  lightboxIndex = (lightboxIndex + delta + galleryItems.length) % galleryItems.length;
  renderLightbox();
}

function ensureVirtualDOM() {
  if (virtualSpacer && virtualWindow && els.results.contains(virtualSpacer)) return;
  els.results.innerHTML =
    '<div class="virtual-spacer" aria-hidden="true"></div><div class="virtual-window"></div>';
  virtualSpacer = els.results.querySelector(".virtual-spacer");
  virtualWindow = els.results.querySelector(".virtual-window");
  wireResultsEvents();
}

function wireResultsEvents() {
  if (resultsWired) return;
  resultsWired = true;

  els.results.addEventListener(
    "error",
    (e) => {
      if (e.target.tagName === "IMG") e.target.remove();
    },
    true
  );

  els.results.addEventListener("click", (e) => {
    const openBtn = e.target.closest(".open-btn");
    if (openBtn) {
      e.stopPropagation();
      const row = openBtn.closest(".row");
      if (row) openTweet(view[Number(row.dataset.i)]);
      return;
    }
    const copyBtn = e.target.closest(".copy-btn");
    if (copyBtn) {
      e.stopPropagation();
      const row = copyBtn.closest(".row");
      if (row) copyLink(view[Number(row.dataset.i)], copyBtn);
      return;
    }
    const row = e.target.closest(".row");
    if (!row) return;
    toggleActive(Number(row.dataset.i));
  });

  els.results.addEventListener("dblclick", (e) => {
    const row = e.target.closest(".row");
    if (row) openTweet(view[Number(row.dataset.i)]);
  });

  els.feedScroll.addEventListener("scroll", () => {
    if (state.mode === "photos") {
      const remaining = els.feedScroll.scrollHeight - els.feedScroll.scrollTop - els.feedScroll.clientHeight;
      if (remaining < 500) appendGalleryBatch();
      return;
    }
    cancelAnimationFrame(paintRaf);
    paintRaf = requestAnimationFrame(() => paintVisible(false));
  });

  window.addEventListener("resize", () => {
    if (state.mode !== "posts") return;
    cancelAnimationFrame(paintRaf);
    paintRaf = requestAnimationFrame(() => paintVisible(false));
  });
}

function syncActiveRowHeightIdentity() {
  const id = state.active >= 0 ? view[state.active]?.tweetId || String(state.active) : null;
  if (id !== activeRowHeightId) {
    activeRowHeightId = id;
    activeRowHeight = Core.ROW_ACTIVE_EXPANDED;
  }
}

function measureActiveRowHeight() {
  const row = virtualWindow?.querySelector(".row.active");
  if (!row) return false;
  const measured = Math.max(Core.ROW_ACTIVE_EXPANDED, Math.ceil(row.getBoundingClientRect().height));
  if (Math.abs(measured - activeRowHeight) <= 1) return false;
  activeRowHeight = measured;
  return true;
}

function rebuildRowLayout() {
  syncActiveRowHeightIdentity();
  rowLayout = Core.buildRowOffsets(view.length, state.active, Core.ROW_COLLAPSED, activeRowHeight);
  if (virtualSpacer) virtualSpacer.style.height = `${rowLayout.totalHeight}px`;
}

function listViewport() {
  const sc = els.feedScroll;
  if (!sc || !els.results) return { scrollTop: 0, vh: 400 };
  const scRect = sc.getBoundingClientRect();
  const resultsRect = els.results.getBoundingClientRect();
  const scrollTop = Math.max(0, sc.scrollTop - els.results.offsetTop);
  const top = Math.max(resultsRect.top, scRect.top);
  const bottom = Math.min(resultsRect.bottom, scRect.bottom);
  const vh = Math.max(120, bottom - top);
  return { scrollTop, vh };
}

function paintVisible(resetScroll) {
  if (state.mode !== "posts" || !view.length || !virtualWindow) return;

  rebuildRowLayout();
  if (resetScroll) els.feedScroll.scrollTop = els.results.offsetTop;

  const { scrollTop, vh } = listViewport();
  const { start, end } = Core.visibleRange(scrollTop, vh, rowLayout);

  if (end < start) {
    virtualWindow.innerHTML = "";
    virtualWindow.style.transform = "translateY(0)";
    return;
  }

  const parts = [];
  for (let i = start; i <= end; i += 1) parts.push(rowHTML(view[i], i));
  virtualWindow.style.transform = `translateY(${rowLayout.tops[start]}px)`;
  virtualWindow.innerHTML = parts.join("");
  if (measureActiveRowHeight()) rebuildRowLayout();
}

function scrollToActive() {
  if (state.active < 0 || !view.length) return;
  const rowTop = rowLayout.tops[state.active];
  const rowH = rowLayout.heights[state.active];
  const resultsTop = els.results.offsetTop;
  const { scrollTop: listTop, vh } = listViewport();
  const margin = 80;
  if (rowTop < listTop + margin) {
    els.feedScroll.scrollTop = Math.max(0, resultsTop + rowTop - margin);
  } else if (rowTop + rowH > listTop + vh - margin) {
    els.feedScroll.scrollTop = resultsTop + rowTop + rowH - vh + margin;
  }
}

function setActive(i, scroll) {
  if (state.mode !== "posts") return;
  state.active = i;
  if (!view.length) return;
  paintVisible(false);
  updateCount(getCachedBase().length);
  if (scroll) scrollToActive();
}

function toggleActive(i) {
  setActive(state.active === i ? -1 : i, false);
}

function showToast(msg) {
  els.toastText.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 1600);
}

function openTweet(t) {
  if (!t?.url) return;
  pushHistory(state.q);
  chrome.tabs.create({ url: t.url, active: true });
}

function sendToWorker(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ source: "xls-feed", ...msg }, (res) => {
        void chrome.runtime?.lastError;
        resolve(res);
      });
    } catch {
      resolve(null);
    }
  });
}

async function toggleSync() {
  const btn = $("#open-likes");
  if (btn && btn.disabled) return;
  if (syncState.running) {
    await sendToWorker({ type: "STOP_SYNC" });
    showToast("Stopping sync…");
    return;
  }
  const res = await sendToWorker({ type: "START_SYNC" });
  if (!res) {
    showToast("Could not reach the extension worker");
    return;
  }
  if (!res.ok) {
    if (/no captured request/i.test(res.error || "")) {
      chrome.tabs.create({ url: "https://x.com/i/history/likes", active: true });
      showToast("Opened X Likes — let it load, then return and sync");
      return;
    }
    showToast(res.error || "Could not start sync");
    return;
  }
  showToast(res.alreadyRunning ? "Sync already running" : "Sync started");
}

async function refreshSyncState() {
  const res = await sendToWorker({ type: "SYNC_STATUS" });
  if (!res?.ok) return;
  const stored = (res && res.state) || {};
  syncState = { ...stored };
  syncState.running = Boolean(res && res.running);
  updateStatus();
}

function scheduleSyncReconcile() {
  if (!syncState.running) {
    clearTimeout(syncReconcileTimer);
    syncReconcileTimer = null;
    return;
  }
  if (syncReconcileTimer) return;
  syncReconcileTimer = setTimeout(async () => {
    syncReconcileTimer = null;
    await refreshSyncState();
    scheduleSyncReconcile();
  }, SYNC_RECONCILE_MS);
}

function copyLink(t, btn) {
  const done = () => {
    btn.classList.add("ok");
    btn.textContent = "✓ copied";
    showToast("Link copied to clipboard");
    setTimeout(() => {
      btn.classList.remove("ok");
      btn.textContent = "⧉ copy link";
    }, 1400);
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(t.url).then(done, done);
  else done();
}

function rebuildView() {
  const base = getCachedBase();
  if (!state.q) view = base;
  else view = base.filter((t) => Core.matches(t, state.q));

  if (state.q && state.active < 0 && view.length) state.active = 0;
  if (state.active >= view.length) state.active = view.length ? 0 : -1;
}

function renderEmptyState() {
  els.results.style.display = "none";
  els.gallery.hidden = true;

  if (state.mode === "photos") {
    els.gallery.innerHTML = "";
    galleryRendered = 0;
    if (Number(indexState.indexVersion || 0) < Core.INDEX_VERSION) {
      els.empty.innerHTML = `<div class="empty"><div class="big">Photos need indexing</div><p>Run a full sync once to add photos to your existing likes.</p></div>`;
    } else if (state.q) {
      els.empty.innerHTML = `<div class="empty"><div class="big">No matching photos</div><p>No liked photos match <span class="q">"${Core.escapeHTML(state.q)}"</span></p></div>`;
    } else {
      els.empty.innerHTML = `<div class="empty"><div class="big">No liked photos</div><p>Your indexed likes do not contain photos yet.</p></div>`;
    }
    return;
  }

  els.results.innerHTML = "";
  virtualSpacer = null;
  virtualWindow = null;
  if (allLikes.length) {
    els.empty.innerHTML = `<div class="empty"><div class="big">No matches</div><p>Nothing liked matches <span class="q">"${Core.escapeHTML(state.q)}"</span></p></div>`;
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

function renderPosts(resetScroll) {
  els.gallery.hidden = true;
  if (!view.length) {
    renderEmptyState();
    return;
  }

  els.empty.innerHTML = "";
  els.results.style.display = "";
  ensureVirtualDOM();
  paintVisible(resetScroll);
}

function renderGallery(resetScroll) {
  els.results.style.display = "none";
  if (!galleryItems.length) {
    renderEmptyState();
    return;
  }
  els.empty.innerHTML = "";
  els.gallery.hidden = false;
  els.gallery.innerHTML = "";
  galleryRendered = 0;
  appendGalleryBatch();
  if (resetScroll) els.feedScroll.scrollTop = els.gallery.offsetTop;
}

function renderCurrentMode(resetScroll = true) {
  rebuildView();
  galleryItems = state.mode === "photos" ? Core.flattenPhotoItems(view) : [];
  if (lightboxIndex >= galleryItems.length) closeLightbox();
  document.body.dataset.mode = state.mode;
  updateStatus();
  updateCount(getCachedBase().length);
  if (state.mode === "photos") renderGallery(resetScroll);
  else renderPosts(resetScroll);
}

function scheduleRender(resetScroll = true) {
  const gen = ++renderGen;
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    if (gen !== renderGen) return;
    renderCurrentMode(resetScroll);
  }, RENDER_DEBOUNCE_MS);
}

function move(delta) {
  if (state.mode !== "posts" || !view.length) return;
  let i = state.active < 0 ? 0 : state.active + delta;
  if (i < 0) i = view.length - 1;
  if (i >= view.length) i = 0;
  setActive(i, true);
}

function applyIndex(index, resetScroll = true) {
  rawLikes = Object.values(index);
  allLikes = rawLikes.map(Core.normalizeLike);
  invalidatePipelineCache();
  renderCurrentMode(resetScroll);
}

function flushPendingIndex() {
  clearTimeout(indexRefreshTimer);
  indexRefreshTimer = null;
  if (!hasPendingIndex) return;
  const index = pendingIndex || {};
  pendingIndex = null;
  hasPendingIndex = false;
  applyIndex(index, false);
}

function queueIndexRefresh(index) {
  pendingIndex = index || {};
  hasPendingIndex = true;
  if (!syncState.running) {
    flushPendingIndex();
    return;
  }
  if (indexRefreshTimer) return;
  indexRefreshTimer = setTimeout(flushPendingIndex, INDEX_REFRESH_MS);
}

async function load() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  applyIndex(data[STORAGE_KEY] || {});
}

async function loadIndexState() {
  const data = await chrome.storage.local.get(STATE_KEY);
  indexState = data[STATE_KEY] || {};
  if (state.mode === "photos" && !galleryItems.length) renderCurrentMode(false);
}

function exportLikes() {
  const blob = new Blob([JSON.stringify(rawLikes, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `x-likes-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function wireEvents() {
  els.theme.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme");
    applyTheme(cur === "dark" ? "light" : "dark");
  });

  els.q.addEventListener("input", () => {
    state.q = els.q.value.trim();
    state.active = -1;
    updateMatchCountPreview();
    scheduleRender(true);
    maybeShowHistory();
    clearTimeout(historyTimer);
    historyTimer = setTimeout(() => {
      if (state.q.length >= 2 && view.length) pushHistory(state.q);
    }, 1100);
  });
  els.q.addEventListener("focus", maybeShowHistory);
  els.q.addEventListener("blur", () => setTimeout(() => els.history.classList.remove("show"), 150));

  els.history.addEventListener("mousedown", (e) => {
    const del = e.target.closest("[data-del]");
    if (del) {
      e.preventDefault();
      setHistory(Core.removeHistory(getHistory(), del.getAttribute("data-del")));
      renderHistory();
      return;
    }
    if (e.target.id === "h-clear") {
      e.preventDefault();
      setHistory([]);
      maybeShowHistory();
      return;
    }
    const item = e.target.closest(".h-item");
    if (item) {
      e.preventDefault();
      els.q.value = item.getAttribute("data-q");
      state.q = els.q.value;
      state.active = -1;
      els.history.classList.remove("show");
      updateMatchCountPreview();
      renderCurrentMode(true);
      els.q.focus();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (lightboxIndex >= 0) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeLightbox();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        moveLightbox(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        moveLightbox(1);
      }
      return;
    }
    if (e.key === "/" && document.activeElement !== els.q) {
      e.preventDefault();
      els.q.focus();
      els.q.select();
      return;
    }
    if (e.key === "Escape") {
      els.history.classList.remove("show");
      if (!els.q.value) return;
      e.preventDefault();
      els.q.value = "";
      state.q = "";
      state.active = -1;
      updateMatchCountPreview();
      renderCurrentMode(true);
      return;
    }
    if (e.key === "ArrowDown") {
      if (state.mode !== "posts") return;
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      if (state.mode !== "posts") return;
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter") {
      if (state.mode !== "posts") return;
      if ((e.metaKey || e.ctrlKey) && state.active >= 0) openTweet(view[state.active]);
      else {
        e.preventDefault();
        move(1);
      }
    }
  });

  els.sort.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    state.sort = btn.dataset.sort;
    [...els.sort.children].forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    invalidatePipelineCache();
    renderCurrentMode(true);
  });

  els.viewMode.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-mode]");
    if (!btn || btn.dataset.mode === state.mode) return;
    state.mode = btn.dataset.mode;
    state.active = -1;
    [...els.viewMode.children].forEach((item) =>
      item.setAttribute("aria-pressed", String(item === btn))
    );
    closeLightbox();
    renderCurrentMode(true);
  });

  els.gallery.addEventListener(
    "error",
    (e) => {
      if (e.target.tagName === "IMG") e.target.closest(".gallery-card")?.classList.add("is-error");
    },
    true
  );
  els.gallery.addEventListener("click", (e) => {
    const card = e.target.closest("[data-gallery-i]");
    if (card) openLightbox(Number(card.dataset.galleryI));
  });
  els.lightbox.addEventListener("click", (e) => {
    if (e.target.closest("[data-lightbox-close]")) {
      closeLightbox();
      return;
    }
    const move = e.target.closest("[data-lightbox-move]");
    if (move) moveLightbox(Number(move.dataset.lightboxMove));
  });
  els.lightboxImage.addEventListener("error", () => {
    els.lightbox.querySelector(".lb-stage").classList.add("is-error");
  });
  $("#lb-open").addEventListener("click", () => {
    const item = galleryItems[lightboxIndex];
    if (item) openTweet(item.tweet);
  });

  $("#open-likes").addEventListener("click", toggleSync);
  $("#export").addEventListener("click", exportLikes);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[SYNC_KEY]) {
      const prevRunning = syncState.running;
      syncState = changes[SYNC_KEY].newValue || {};
      updateStatus();
      if (!syncState.running) flushPendingIndex();
      if (syncState.done && syncState.error) showToast(syncState.error);
      else if (syncState.done && prevRunning) showToast(syncState.message || "Sync finished");
    }
    if (changes[STORAGE_KEY]) queueIndexRefresh(changes[STORAGE_KEY].newValue);
    if (changes[STATE_KEY]) {
      indexState = changes[STATE_KEY].newValue || {};
      if (state.mode === "photos" && !galleryItems.length) renderCurrentMode(false);
    }
  });

  window.addEventListener("pagehide", () => {
    clearTimeout(syncReconcileTimer);
    clearTimeout(indexRefreshTimer);
  });
}

initTheme();
wireEvents();
load();
loadIndexState();
refreshSyncState();

window.__feedApp = {
  state,
  get allLikes() {
    return allLikes;
  },
  get view() {
    return view;
  },
  load,
  render: renderCurrentMode,
  RENDER_DEBOUNCE_MS,
  INDEX_REFRESH_MS,
  SYNC_RECONCILE_MS,
  GALLERY_BATCH_SIZE,
};
