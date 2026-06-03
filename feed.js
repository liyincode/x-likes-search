const STORAGE_KEY = "x_likes_index";
const STATE_KEY = "x_likes_state";
const SYNC_KEY = "x_likes_sync";
const HISTORY_KEY = "finder-history";
const THEME_KEY = "finder-theme";
const RENDER_DEBOUNCE_MS = 200;

const Core = window.FeedCore;
const $ = (s) => document.querySelector(s);

const els = {
  q: $("#q"),
  feedScroll: $("#feed-scroll"),
  results: $("#results"),
  empty: $("#empty"),
  count: $("#mc"),
  status: $("#sb-status"),
  history: $("#history"),
  sort: $("#sort"),
  theme: $("#theme-btn"),
  toast: $("#toast"),
  toastText: $("#toast-txt"),
};

const state = { q: "", sort: "newest", author: "all", mediaOnly: false, active: -1 };
let allLikes = [];
let view = [];
let rawLikes = [];
let toastTimer = null;
let historyTimer = null;
let syncState = {};

let cachedBase = null;
let cachedPipelineKey = null;
let renderTimer = null;
let renderGen = 0;
let paintRaf = 0;
let rowLayout = { tops: [], heights: [], totalHeight: 0 };
let virtualSpacer = null;
let virtualWindow = null;
let resultsWired = false;

const SUN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/></svg>';
const MOON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 13A8.5 8.5 0 1 1 11 3a6.5 6.5 0 0 0 10 10z"/></svg>';

function appNow() {
  return window.__XLS_NOW ? new Date(window.__XLS_NOW) : new Date();
}

function pipelineCacheKey() {
  return `${state.sort}|${state.author}|${state.mediaOnly ? 1 : 0}`;
}

function invalidatePipelineCache() {
  cachedPipelineKey = null;
  cachedBase = null;
}

function getCachedBase() {
  const key = pipelineCacheKey();
  if (cachedBase && cachedPipelineKey === key) return cachedBase;
  cachedPipelineKey = key;
  cachedBase = Core.pipeline(allLikes, state);
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
  if (syncState.running) {
    els.status.textContent = `Syncing… ${allLikes.length} liked`;
  } else if (syncState.error) {
    els.status.textContent = syncState.error;
  } else if (syncState.done && syncState.message) {
    els.status.textContent = `${allLikes.length} liked · ${syncState.message}`;
  } else {
    els.status.textContent = `${allLikes.length} liked · local only`;
  }
  const sbStatus = els.status.closest(".sb-status");
  if (sbStatus) sbStatus.classList.toggle("is-syncing", Boolean(syncState.running));
  updateSyncButtons();
}

function updateSyncButtons() {
  const remote = syncState.running && syncState.source === "page";
  const btn = $("#open-likes");
  if (btn) btn.textContent = syncState.running && !remote ? "stop" : "sync";
  const empty = allLikes.length === 0;
  const setHidden = (sel, hidden) => {
    const el = $(sel);
    if (el) el.style.display = hidden ? "none" : "";
  };
  setHidden("#open-likes", empty);
  setHidden("#export", empty);
  setHidden(".filters", empty);
}

function updateCount(baseLen) {
  if (state.q) {
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
  const mediaTag = t.media ? `<span class="mtag">▦ ${Core.escapeHTML(t.media.type || "media")}</span>` : "";
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
          ${mediaTag}
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
      <div class="when">${Core.relativeDate(t.date, appNow())}</div>
    </div>`;
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
    cancelAnimationFrame(paintRaf);
    paintRaf = requestAnimationFrame(() => paintVisible(false));
  });

  window.addEventListener("resize", () => {
    cancelAnimationFrame(paintRaf);
    paintRaf = requestAnimationFrame(() => paintVisible(false));
  });
}

function rebuildRowLayout() {
  rowLayout = Core.buildRowOffsets(view.length, state.active);
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
  if (!view.length || !virtualWindow) return;

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
  chrome.tabs.create({ url: t.url, active: false });
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
  if (syncState.running) {
    if (syncState.source === "page") {
      showToast("Syncing on your X tab — click Stop there");
      return;
    }
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
    showToast(res.error || "Could not start sync");
    return;
  }
  showToast(res.alreadyRunning ? "Sync already running" : "Sync started");
}

async function refreshSyncState() {
  const res = await sendToWorker({ type: "SYNC_STATUS" });
  syncState = (res && res.state) || {};
  if (res) syncState.running = Boolean(res.running);
  updateStatus();
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
  els.results.innerHTML = "";
  els.results.style.display = "none";
  virtualSpacer = null;
  virtualWindow = null;

  if (allLikes.length) {
    els.empty.innerHTML = `<div class="empty"><div class="big">No matches</div><p>Nothing liked matches <span class="q">"${Core.escapeHTML(state.q)}"</span></p></div>`;
  } else {
    els.empty.innerHTML = `
        <div class="empty">
          <div class="big">No likes indexed yet</div>
          <div class="steps-guide">
            <div class="step"><div class="n">1</div><div><div class="sb">Open your X likes page</div><div class="ss">Go to <a href="https://x.com" target="_blank" rel="noreferrer">x.com</a> → Profile → Likes.</div></div></div>
            <div class="step"><div class="n">2</div><div><div class="sb">Click Sync</div><div class="ss">Hit the <b>Sync</b> button under the Likes tab.</div></div></div>
          </div>
        </div>`;
  }
}

function renderList(resetScroll = true) {
  rebuildView();
  updateStatus();
  updateCount(getCachedBase().length);

  if (!view.length) {
    renderEmptyState();
    return;
  }

  els.empty.innerHTML = "";
  els.results.style.display = "";
  ensureVirtualDOM();
  paintVisible(resetScroll);
}

function scheduleRender(resetScroll = true) {
  const gen = ++renderGen;
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => {
    if (gen !== renderGen) return;
    renderList(resetScroll);
  }, RENDER_DEBOUNCE_MS);
}

function move(delta) {
  if (!view.length) return;
  let i = state.active < 0 ? 0 : state.active + delta;
  if (i < 0) i = view.length - 1;
  if (i >= view.length) i = 0;
  setActive(i, true);
}

async function load() {
  const data = await chrome.storage.local.get([STORAGE_KEY, STATE_KEY]);
  const index = data[STORAGE_KEY] || {};
  rawLikes = Object.values(index);
  allLikes = rawLikes.map(Core.normalizeLike);
  invalidatePipelineCache();
  renderList();
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
      renderList(true);
      els.q.focus();
    }
  });

  document.addEventListener("keydown", (e) => {
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
      renderList(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter") {
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
    renderList(true);
  });

  $("#open-likes").addEventListener("click", toggleSync);
  $("#export").addEventListener("click", exportLikes);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[SYNC_KEY]) {
      const prevRunning = syncState.running;
      syncState = changes[SYNC_KEY].newValue || {};
      updateStatus();
      if (syncState.done && syncState.error) showToast(syncState.error);
      else if (syncState.done && prevRunning) showToast(syncState.message || "Sync finished");
    }
    if (changes[STORAGE_KEY] || changes[STATE_KEY]) load();
  });
}

initTheme();
wireEvents();
load();
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
  render: renderList,
  RENDER_DEBOUNCE_MS,
};
