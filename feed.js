const STORAGE_KEY = "x_likes_index";
const STATE_KEY = "x_likes_state";
const HISTORY_KEY = "finder-history";
const THEME_KEY = "finder-theme";
const X_LIKES_URL = "https://x.com/i/likes";

const Core = window.FeedCore;
const $ = (s) => document.querySelector(s);

const els = {
  q: $("#q"),
  results: $("#results"),
  empty: $("#empty"),
  count: $("#mc"),
  status: $("#sb-status"),
  history: $("#history"),
  author: $("#author"),
  mediaOnly: $("#media-only"),
  sort: $("#sort"),
  theme: $("#theme-btn"),
  onboard: $("#onboard"),
  toast: $("#toast"),
  toastText: $("#toast-txt"),
  obTotal: $("#ob-total"),
  obBar: $("#ob-bar"),
};

const state = { q: "", sort: "newest", mediaOnly: false, author: "all", active: -1 };
let allLikes = [];
let view = [];
let rawLikes = [];
let toastTimer = null;
let historyTimer = null;
let syncButtonText = "";

const SUN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/></svg>';
const MOON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 13A8.5 8.5 0 1 1 11 3a6.5 6.5 0 0 0 10 10z"/></svg>';

function appNow() {
  return window.__XLS_NOW ? new Date(window.__XLS_NOW) : new Date();
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
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved === "light" ? "light" : "dark");
}

function updateAuthors() {
  const selected = state.author;
  els.author.innerHTML =
    '<option value="all">all authors</option>' +
    Core.authors(allLikes)
      .map((a) => `<option value="${Core.escapeHTML(a.handle)}">@${Core.escapeHTML(a.handle)}</option>`)
      .join("");
  els.author.value = selected && [...els.author.options].some((o) => o.value === selected) ? selected : "all";
  state.author = els.author.value;
}

function updateStatus() {
  els.status.textContent = `${allLikes.length} liked · local only`;
  els.obTotal.textContent = String(allLikes.length);
  els.obBar.style.width = allLikes.length ? "100%" : "0";
}

function updateCount(baseLen) {
  if (state.q) {
    const idx = state.active >= 0 ? state.active + 1 : 0;
    els.count.innerHTML = `<b>${idx}</b> / ${view.length} in ${allLikes.length}`;
  } else {
    els.count.textContent = `${baseLen} of ${allLikes.length}`;
  }
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
  return `
    <div class="row" data-i="${i}" data-id="${Core.escapeHTML(t.tweetId)}">
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

function paintActive() {
  [...els.results.children].forEach((el, i) => el.classList.toggle("active", i === state.active));
}

function scrollToActive() {
  const el = els.results.children[state.active];
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.top < 150 || r.bottom > window.innerHeight - 70) window.scrollBy({ top: r.top - 200, behavior: "smooth" });
}

function setActive(i, scroll) {
  state.active = i;
  paintActive();
  updateCount(Core.pipeline(allLikes, state).length);
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

function tabsQuery(query) {
  return new Promise((resolve) => chrome.tabs.query(query, resolve));
}

function tabsCreate(args) {
  return new Promise((resolve) => chrome.tabs.create(args, resolve));
}

function tabsSendMessage(tabId, msg) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, (res) => {
      const err = chrome.runtime?.lastError;
      if (err) reject(new Error(err.message));
      else resolve(res);
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendMessageWithRetry(tabId, msg) {
  let lastError = null;
  for (let i = 0; i < 30; i += 1) {
    try {
      return await tabsSendMessage(tabId, msg);
    } catch (e) {
      lastError = e;
      await wait(500);
    }
  }
  throw lastError || new Error("Could not reach the X likes tab.");
}

async function findOrCreateLikesTab() {
  const tabs = await tabsQuery({
    url: [
      "https://x.com/i/likes*",
      "https://x.com/*/likes*",
      "https://twitter.com/i/likes*",
      "https://twitter.com/*/likes*",
    ],
  });
  const existing = tabs.find((tab) => {
    if (!tab.id || !tab.url) return false;
    try {
      return /\/(?:i\/likes|[^/]+\/likes)/.test(new URL(tab.url).pathname);
    } catch {
      return false;
    }
  });
  if (existing) return existing;
  return tabsCreate({ url: X_LIKES_URL, active: false });
}

async function startSyncFromFeed(button) {
  syncButtonText = syncButtonText || button.textContent;
  button.disabled = true;
  button.textContent = "syncing…";
  try {
    const tab = await findOrCreateLikesTab();
    const result = await sendMessageWithRetry(tab.id, { source: "xls-feed", type: "START_SYNC" });
    if (!result?.ok) throw new Error(result?.error || "Could not start sync.");
    showToast("Sync started in X tab");
  } catch (e) {
    showToast(e.message || "Could not start sync");
  } finally {
    button.disabled = false;
    button.textContent = syncButtonText;
  }
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

function bindRows() {
  [...els.results.children].forEach((el, i) => {
    el.addEventListener("click", () => toggleActive(i));
    el.addEventListener("dblclick", () => openTweet(view[i]));
    el.querySelector("img")?.addEventListener("error", (ev) => {
      ev.currentTarget.remove();
    });
    el.querySelector(".open-btn")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      openTweet(view[i]);
    });
    el.querySelector(".copy-btn")?.addEventListener("click", (ev) => {
      ev.stopPropagation();
      copyLink(view[i], ev.currentTarget);
    });
  });
}

function render() {
  const base = Core.pipeline(allLikes, state);
  view = base.filter((t) => Core.matches(t, state.q));
  if (state.q && state.active < 0 && view.length) state.active = 0;
  if (state.active >= view.length) state.active = view.length ? 0 : -1;
  updateStatus();
  updateCount(base.length);

  if (!view.length) {
    els.results.innerHTML = "";
    const body = allLikes.length
      ? `<div class="big">No matches</div><p>Nothing liked matches <span class="q">"${Core.escapeHTML(state.q)}"</span></p>`
      : `<div class="big">No likes indexed yet</div><p>Open <code>https://x.com/&lt;your-username&gt;/likes</code>, click <b>Sync</b>, then search here.</p>`;
    els.empty.innerHTML = `<div class="empty">${body}</div>`;
    return;
  }

  els.empty.innerHTML = "";
  els.results.innerHTML = view.map(rowHTML).join("");
  bindRows();
  paintActive();
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
  updateAuthors();
  render();
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

async function clearCache() {
  if (!confirm("Clear all cached likes? This does not unlike anything on X.")) return;
  await chrome.storage.local.remove([STORAGE_KEY, STATE_KEY]);
  await load();
  showToast("Local cache cleared");
}

function wireEvents() {
  els.theme.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme");
    applyTheme(cur === "dark" ? "light" : "dark");
  });

  els.q.addEventListener("input", () => {
    state.q = els.q.value.trim();
    state.active = -1;
    render();
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
      render();
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
      if (els.q.value) {
        els.q.value = "";
        state.q = "";
        state.active = -1;
        render();
      }
      els.history.classList.remove("show");
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
    render();
  });

  els.mediaOnly.addEventListener("click", () => {
    state.mediaOnly = !state.mediaOnly;
    els.mediaOnly.classList.toggle("on", state.mediaOnly);
    els.mediaOnly.setAttribute("aria-pressed", String(state.mediaOnly));
    state.active = -1;
    render();
  });

  els.author.addEventListener("change", () => {
    state.author = els.author.value;
    state.active = -1;
    render();
  });

  $("#open-likes").addEventListener("click", (e) => startSyncFromFeed(e.currentTarget));
  $("#ob-open").addEventListener("click", (e) => startSyncFromFeed(e.currentTarget));
  $("#export").addEventListener("click", exportLikes);
  $("#clear").addEventListener("click", clearCache);
  $("#show-onboard").addEventListener("click", () => els.onboard.classList.add("show"));
  $("#ob-close").addEventListener("click", () => els.onboard.classList.remove("show"));
  els.onboard.addEventListener("click", (e) => {
    if (e.target === els.onboard) els.onboard.classList.remove("show");
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[STORAGE_KEY] || changes[STATE_KEY]) load();
  });
}

initTheme();
wireEvents();
load();

window.__feedApp = { state, get allLikes() { return allLikes; }, get view() { return view; }, load, render };
