// Content script. Injects inject.js into the page world (so it can patch
// window.fetch before X loads), bridges messages between the page world and
// chrome.storage, and orchestrates paginated GraphQL syncs.

(() => {
  const STORAGE_KEY = "x_likes_index";
  const STATE_KEY = "x_likes_state";
  const TEMPLATE_KEY = "x_likes_template";
  const SYNC_KEY = "x_likes_sync"; // transient progress, watched by the feed page

  // After reloading the extension, old content scripts lose chrome.* APIs.
  function extensionAlive() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch (_) {
      return false;
    }
  }

  async function storageGet(keys) {
    if (!extensionAlive()) return {};
    try {
      return await chrome.storage.local.get(keys);
    } catch (_) {
      return {};
    }
  }

  async function storageSet(items) {
    if (!extensionAlive()) return;
    try {
      await chrome.storage.local.set(items);
    } catch (_) {}
  }

  // ---- Inject page-world script ASAP ----
  try {
    const s = document.createElement("script");
    s.src = chrome.runtime.getURL("inject.js");
    s.async = false;
    (document.head || document.documentElement).appendChild(s);
    s.onload = () => s.remove();
  } catch (_) {}

  // ---- Page <-> content bridge ----
  let capturedTemplate = null;
  const pending = new Map();
  const templateWaiters = [];
  let nextReqId = 0;

  storageGet(TEMPLATE_KEY).then((d) => {
    if (d[TEMPLATE_KEY]) capturedTemplate = d[TEMPLATE_KEY];
  });

  window.addEventListener("message", (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== "xls") return;
    try {
      if (d.type === "TEMPLATE_CAPTURED") {
        capturedTemplate = d.template;
        void storageSet({ [TEMPLATE_KEY]: capturedTemplate });
        while (templateWaiters.length) templateWaiters.shift()(capturedTemplate);
      } else if (d.type === "PAGE_RESULT") {
        const p = pending.get(d.id);
        if (!p) return;
        pending.delete(d.id);
        d.ok ? p.resolve(d.body) : p.reject(new Error(d.error || `HTTP ${d.status}`));
      }
    } catch (_) {
      // Extension was reloaded — refresh the x.com tab to reconnect.
    }
  });

  function pageFetch(url, headers) {
    return new Promise((resolve, reject) => {
      const id = ++nextReqId;
      pending.set(id, { resolve, reject });
      window.postMessage(
        { source: "xls-cmd", type: "FETCH_PAGE", id, url, headers },
        "*"
      );
    });
  }

  // ---- Storage helpers ----
  async function loadIndex() {
    const d = await storageGet(STORAGE_KEY);
    return d[STORAGE_KEY] || {};
  }
  async function saveIndex(idx) {
    await storageSet({ [STORAGE_KEY]: idx });
  }
  async function setState(patch) {
    const cur = await storageGet(STATE_KEY);
    const next = { ...(cur[STATE_KEY] || {}), ...patch };
    await storageSet({ [STATE_KEY]: next });
    return next;
  }

  // Mirror coarse sync status into SYNC_KEY so the feed page's status bar can
  // show a live "Syncing… N liked" indicator while this page-driven sync runs.
  // The live count itself comes from the index growing after every page; here we
  // only flip the running flag and tag the source so the feed knows it can't
  // Stop this run remotely.
  async function setSyncState(patch) {
    const cur = (await storageGet(SYNC_KEY))[SYNC_KEY] || {};
    await storageSet({ [SYNC_KEY]: { ...cur, ...patch, source: "page" } });
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function waitForTemplate(timeout = 12000) {
    if (capturedTemplate) return Promise.resolve(capturedTemplate);
    return new Promise((resolve) => {
      const done = (template) => {
        clearTimeout(timer);
        resolve(template);
      };
      const timer = setTimeout(() => {
        const idx = templateWaiters.indexOf(done);
        if (idx >= 0) templateWaiters.splice(idx, 1);
        resolve(null);
      }, timeout);
      templateWaiters.push(done);
      try {
        window.scrollBy(0, window.innerHeight);
      } catch (_) {}
    });
  }

  // ---- Response parser ----
  // Shared with background.js via feed-core.js (loaded as a content script
  // before this file). Falls back to a no-op if it somehow isn't present.
  const parseLikesResponse =
    (globalThis.FeedCore && globalThis.FeedCore.parseLikesResponse) ||
    (() => ({ tweets: [], nextCursor: null }));

  // ---- Sync orchestrator ----
  let syncing = false;
  let stopRequested = false;

  async function syncLikes() {
    if (syncing) return { ok: false, error: "Sync already running." };
    syncing = true;
    stopRequested = false;

    if (!capturedTemplate) {
      const d = await storageGet(TEMPLATE_KEY);
      capturedTemplate = d[TEMPLATE_KEY] || null;
    }
    if (!extensionAlive()) {
      const error = "Extension was reloaded — refresh this page and try again.";
      setStatus(error);
      syncing = false;
      return { ok: false, error };
    }
    if (!capturedTemplate) {
      setStatus("Waiting for X to load…");
      capturedTemplate = await waitForTemplate();
    }
    if (!capturedTemplate) {
      const error = "No request captured yet — refresh your likes page and try again.";
      setStatus(error);
      syncing = false;
      return { ok: false, error };
    }

    const baseUrl = capturedTemplate.url;
    const headers = capturedTemplate.headers || {};
    let url;
    try {
      url = new URL(baseUrl);
    } catch (e) {
      const error = "Stale request — refresh your likes page and try again.";
      setStatus(error);
      syncing = false;
      return { ok: false, error };
    }

    const variablesRaw = url.searchParams.get("variables") || "{}";
    let variables;
    try {
      variables = JSON.parse(variablesRaw);
    } catch {
      variables = {};
    }

    const index = await loadIndex();
    let totalCount = Object.keys(index).length;
    let added = 0;
    let pages = 0;
    let cursor = null;
    let consecutiveEmpty = 0;

    setStatus("Starting sync…");
    setFabCount(totalCount); // show the cached total right away, then climb
    await setSyncState({ running: true, done: false, error: null, message: "Syncing…" });

    while (!stopRequested) {
      const vars = { ...variables };
      if (cursor) vars.cursor = cursor;
      url.searchParams.set("variables", JSON.stringify(vars));

      let body;
      try {
        body = await pageFetch(url.toString(), headers);
      } catch (e) {
        setStatus(`Sync error: ${e.message} — stopped.`);
        break;
      }

      if (body && body.errors && !body.data) {
        setStatus(`X returned errors: ${JSON.stringify(body.errors).slice(0, 120)}…`);
        break;
      }

      const { tweets, nextCursor } = parseLikesResponse(body);
      pages += 1;

      let newThisPage = 0;
      for (const t of tweets) {
        if (!index[t.tweetId]) {
          index[t.tweetId] = t;
          added += 1;
          totalCount += 1;
          newThisPage += 1;
        }
      }
      await saveIndex(index);

      if (newThisPage === 0) consecutiveEmpty += 1;
      else consecutiveEmpty = 0;

      setFabCount(totalCount);
      setStatus(`Syncing… ${totalCount} liked (+${added} this run)`);

      if (!nextCursor) break;
      if (nextCursor === cursor) break;
      // If we keep getting only known tweets, assume we've caught up.
      if (consecutiveEmpty >= 3) break;
      cursor = nextCursor;

      await sleep(700); // be polite
    }

    await setState({ lastSyncAt: Date.now(), total: totalCount });
    const finalStatus = stopRequested
      ? `Stopped — ${totalCount} liked (+${added})`
      : `Done — ${totalCount} liked (+${added})`;
    setStatus(finalStatus);
    await setSyncState({
      running: false,
      done: true,
      message: stopRequested ? "Stopped." : "Done.",
    });
    syncing = false;
    return { ok: true, total: totalCount, added, stopped: stopRequested };
  }

  // ---- UI panel ----
  function isLikesPage() {
    return /^\/[^/]+\/likes\/?$/.test(location.pathname) || location.pathname === "/i/likes";
  }

  // A small "Sync" pill anchored inside X's "Your likes are private" banner.
  // It's a tiny state machine: idle → click → syncing (spinner) → click → stop,
  // or auto done/error. The label changes per state; live progress (a tweet
  // count) shows in the hover tooltip.
  // Live running total shown right on the pill while syncing (so you don't have
  // to hover to see progress). null/0 → no number yet.
  let fabCount = null;

  function setStatus(msg) {
    const el = document.querySelector("#xls-fab .xls-fab-tip");
    if (el) el.textContent = msg;
  }

  function renderFabLabel() {
    const fab = document.getElementById("xls-fab");
    if (!fab) return;
    const label = fab.querySelector(".xls-fab-label");
    if (!label) return;
    const n = fabCount ? fabCount.toLocaleString() : null;
    const state = fab.dataset.state;
    let text;
    if (state === "syncing") text = n || "Syncing";
    else if (state === "done") text = n ? `Synced ${n}` : "Synced";
    else if (state === "error") text = "Retry";
    else text = "Sync";
    if (label.textContent !== text) {
      label.textContent = text;
      scheduleReposition(); // width changed; keep the right edge anchored
    }
  }

  function setFabState(state) {
    const fab = document.getElementById("xls-fab");
    if (!fab) return;
    fab.dataset.state = state;
    if (state === "idle") fabCount = null;
    renderFabLabel();
  }

  function setFabCount(n) {
    fabCount = n;
    renderFabLabel();
  }

  async function onFabClick() {
    if (syncing) {
      stopRequested = true;
      setStatus("Stopping…");
      return;
    }
    setFabState("syncing");
    let res;
    try {
      res = await syncLikes();
    } catch (e) {
      res = { ok: false, error: e && e.message };
    }
    if (res && res.ok) {
      setFabState("done");
      setTimeout(() => setFabState("idle"), 2400);
    } else {
      setFabState("error");
      setTimeout(() => setFabState("idle"), 3000);
    }
  }

  // We never inject into X's React tree (it would get reconciled away). We own a
  // body-level node and keep it positioned, following scroll. Preferred anchor is
  // the "Your likes are private" banner (so the pill reads as part of it); we fall
  // back to sitting just below the Likes tab when the banner isn't found.
  const BANNER_PAD = 14; // px gap from the banner's right inner edge
  const TAB_GAP = 10; // px below the tab when there's no banner to anchor to

  // Find the profile "Likes" tab by its href, not class names (which X hashes)
  // or label text (which is localized).
  function findLikesTab() {
    const links = document.querySelectorAll('a[role="tab"], [role="tablist"] a, nav a');
    for (const a of links) {
      const href = (a.getAttribute("href") || "").split("?")[0];
      if (/\/likes\/?$/.test(href)) return a;
    }
    return null;
  }

  // Cache the banner NODE so we don't re-hit-test every frame. Re-hit-testing
  // was the source of the jitter: the sample point could land on our own (now
  // wider) pill, so detection flickered between banner-anchor and tab-fallback,
  // and the right-edge gap jumped. With a cached node the anchor stays put.
  let bannerNode = null;

  // Locate the colored privacy banner under the tabs once: sample its LEFT side
  // (far from our right-aligned pill), with the pill made transparent to hit
  // testing as a belt-and-suspenders, then walk up to the first ancestor that
  // actually paints a background. No reliance on X's hashed classes/testids.
  function findBannerNode(tabRect) {
    const btn = document.getElementById("xls-fab");
    const prevPE = btn && btn.style.pointerEvents;
    if (btn) btn.style.pointerEvents = "none";
    const x = Math.max(8, Math.round(tabRect.left - 200));
    const y = Math.round(tabRect.bottom + 14);
    let el = document.elementFromPoint(x, y);
    if (btn) btn.style.pointerEvents = prevPE || "";
    while (el && el !== document.body && el.id !== "xls-fab") {
      const bg = getComputedStyle(el).backgroundColor;
      const m = bg && bg.match(/rgba?\(([^)]+)\)/);
      if (m) {
        const p = m[1].split(",").map((s) => parseFloat(s));
        if ((p.length === 4 ? p[3] : 1) > 0) return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  function bannerRect(tabRect) {
    if (!bannerNode || !bannerNode.isConnected) {
      bannerNode = findBannerNode(tabRect);
    }
    if (!bannerNode || !bannerNode.isConnected) return null;
    const r = bannerNode.getBoundingClientRect();
    // Drop a stale cache if it no longer looks like the column-wide banner.
    if (r.width < tabRect.width || r.height === 0 || r.height > 160) {
      bannerNode = null;
      return null;
    }
    return r;
  }

  function positionButton() {
    const btn = document.getElementById("xls-fab");
    if (!btn) return;
    const tab = isLikesPage() ? findLikesTab() : null;
    const tr = tab ? tab.getBoundingClientRect() : null;
    if (!tr || tr.width === 0 || tr.bottom <= 0) {
      btn.style.display = "none";
      return;
    }
    btn.style.display = "inline-flex";
    const bh = btn.offsetHeight || 32; // constant; only used for vertical centering
    const banner = bannerRect(tr);
    let rightEdge, top;
    if (banner) {
      rightEdge = banner.right - BANNER_PAD; // right-aligned & v-centered in banner
      top = banner.top + banner.height / 2 - bh / 2;
    } else {
      rightEdge = tr.right; // fall back to right-aligned just below the tab
      top = tr.bottom + TAB_GAP;
    }
    // Anchor by the CSS *right* edge, not a width-derived left, so the pill stays
    // pinned on the right while the label (count) grows/shrinks — no jitter, and
    // no dependency on measuring an in-flux width.
    btn.style.left = "auto";
    btn.style.right = Math.round(window.innerWidth - rightEdge) + "px";
    btn.style.top = Math.round(top) + "px";
  }

  let repositionPending = false;
  function scheduleReposition() {
    if (repositionPending) return;
    repositionPending = true;
    requestAnimationFrame(() => {
      repositionPending = false;
      positionButton();
    });
  }

  function injectPanel() {
    if (document.getElementById("xls-fab")) return;
    const fab = document.createElement("div");
    fab.id = "xls-fab";
    fab.dataset.state = "idle";
    fab.setAttribute("role", "button");
    fab.setAttribute("tabindex", "0");
    fab.setAttribute("aria-label", "Sync likes");
    fab.innerHTML = `
      <style>
        #xls-fab {
          position: fixed; top: 0; left: 0; z-index: 2147483646; display: none;
          align-items: center; gap: 6px; box-sizing: border-box;
          height: 32px; padding: 0 16px; border-radius: 999px;
          background: #1d9bf0; color: #fff; border: 0; cursor: pointer;
          font: 700 14px/1 -apple-system, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          box-shadow: 0 1px 3px rgba(0,0,0,.18);
          transition: transform .14s ease, background-color .2s ease, box-shadow .18s ease;
          -webkit-tap-highlight-color: transparent; user-select: none;
        }
        #xls-fab:hover, #xls-fab:focus-visible {
          background: #1a8cd8; transform: translateY(-1px); outline: none;
          box-shadow: 0 3px 12px rgba(29,155,240,.4);
        }
        #xls-fab:active { transform: translateY(0) scale(.97); }
        #xls-fab .xls-fab-spin {
          width: 15px; height: 15px; margin-left: -2px; display: none;
        }
        #xls-fab[data-state="syncing"] .xls-fab-spin {
          display: block; animation: xls-spin .8s linear infinite;
        }
        #xls-fab[data-state="done"] { background: #00ba7c; }
        #xls-fab[data-state="done"]:hover { background: #00a86d; }
        #xls-fab[data-state="error"] {
          background: #f4212e; animation: xls-shake .42s ease;
        }
        #xls-fab[data-state="error"]:hover { background: #d91a26; }
        #xls-fab .xls-fab-label { display: inline-block; }
        #xls-fab .xls-fab-tip {
          position: absolute; top: calc(100% + 8px); right: 0;
          white-space: nowrap; max-width: 60vw;
          background: #15202b; color: #fff; border: 1px solid #38444d;
          font: 400 12px/1.3 -apple-system, system-ui, sans-serif;
          padding: 6px 10px; border-radius: 8px;
          box-shadow: 0 4px 14px rgba(0,0,0,.35);
          opacity: 0; pointer-events: none;
          transform: translateY(-4px);
          transition: opacity .15s ease, transform .15s ease;
        }
        #xls-fab .xls-fab-tip:empty { display: none; }
        #xls-fab:hover .xls-fab-tip, #xls-fab:focus-visible .xls-fab-tip {
          opacity: 1; transform: translateY(0);
        }
        @keyframes xls-spin { to { transform: rotate(360deg); } }
        @keyframes xls-shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-4px); }
          40% { transform: translateX(4px); }
          60% { transform: translateX(-3px); }
          80% { transform: translateX(2px); }
        }
        @media (prefers-reduced-motion: reduce) {
          #xls-fab, #xls-fab * { animation: none !important; }
        }
      </style>
      <svg class="xls-fab-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2.6" stroke-linecap="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-6.22-8.56"/>
      </svg>
      <span class="xls-fab-label">Sync</span>
      <span class="xls-fab-tip"></span>
    `;
    document.body.appendChild(fab);
    fab.addEventListener("click", onFabClick);
    fab.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onFabClick();
      }
    });
    scheduleReposition();
  }

  function maybeInject() {
    if (isLikesPage() && document.body) injectPanel();
    scheduleReposition();
  }

  // SPA route changes + nav re-renders + layout shifts all trigger a reposition.
  let lastUrl = location.href;
  const obs = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      maybeInject();
    }
    scheduleReposition();
  });
  function startObserving() {
    obs.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("scroll", scheduleReposition, true);
    window.addEventListener("resize", scheduleReposition);
    maybeInject();
  }
  if (document.body) startObserving();
  else document.addEventListener("DOMContentLoaded", startObserving);
})();
