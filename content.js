// Content script. Injects inject.js into the page world (so it can patch
// window.fetch before X loads), bridges messages between the page world and
// chrome.storage, and orchestrates paginated GraphQL syncs.

(() => {
  const STORAGE_KEY = "x_likes_index";
  const STATE_KEY = "x_likes_state";
  const TEMPLATE_KEY = "x_likes_template";

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

  chrome.storage.local.get(TEMPLATE_KEY).then((d) => {
    if (d[TEMPLATE_KEY]) capturedTemplate = d[TEMPLATE_KEY];
    updatePanelStatus();
  });

  window.addEventListener("message", (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== "xls") return;
    if (d.type === "TEMPLATE_CAPTURED") {
      capturedTemplate = d.template;
      chrome.storage.local.set({ [TEMPLATE_KEY]: capturedTemplate });
      while (templateWaiters.length) templateWaiters.shift()(capturedTemplate);
      updatePanelStatus();
    } else if (d.type === "PAGE_RESULT") {
      const p = pending.get(d.id);
      if (!p) return;
      pending.delete(d.id);
      d.ok ? p.resolve(d.body) : p.reject(new Error(d.error || `HTTP ${d.status}`));
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
    const d = await chrome.storage.local.get(STORAGE_KEY);
    return d[STORAGE_KEY] || {};
  }
  async function saveIndex(idx) {
    await chrome.storage.local.set({ [STORAGE_KEY]: idx });
  }
  async function setState(patch) {
    const cur = await chrome.storage.local.get(STATE_KEY);
    const next = { ...(cur[STATE_KEY] || {}), ...patch };
    await chrome.storage.local.set({ [STATE_KEY]: next });
    return next;
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
  function parseLikesResponse(body) {
    const tweets = [];
    let nextCursor = null;

    const timeline =
      body?.data?.user?.result?.timeline_v2?.timeline ||
      body?.data?.user?.result?.timeline?.timeline ||
      null;
    const instructions = timeline?.instructions || [];

    for (const ins of instructions) {
      if (ins.type === "TimelineReplaceEntry" && ins.entry) {
        // Cursor-only entry
        const c = ins.entry.content || {};
        if (c.entryType === "TimelineTimelineCursor" && c.cursorType === "Bottom" && c.value) {
          nextCursor = c.value;
        }
      }
      const entries = ins.entries || [];
      for (const entry of entries) {
        const c = entry.content || {};
        if (c.entryType === "TimelineTimelineItem" && c.itemContent?.itemType === "TimelineTweet") {
          let res = c.itemContent.tweet_results?.result;
          if (!res) continue;
          if (res.__typename === "TweetWithVisibilityResults" && res.tweet) res = res.tweet;
          const tweetId = res.rest_id || res.legacy?.id_str;
          if (!tweetId) continue;
          const text =
            res.note_tweet?.note_tweet_results?.result?.text ||
            res.legacy?.full_text ||
            "";
          const datetime = res.legacy?.created_at || null;
          const userRes = res.core?.user_results?.result;
          const author =
            userRes?.legacy?.screen_name || userRes?.core?.screen_name || "";
          const displayName =
            userRes?.legacy?.name || userRes?.core?.name || "";
          const avatar =
            userRes?.legacy?.profile_image_url_https ||
            userRes?.avatar?.image_url ||
            "";
          const likes = res.legacy?.favorite_count;
          const reposts = res.legacy?.retweet_count;
          tweets.push({
            tweetId,
            text,
            datetime,
            author,
            displayName,
            avatar,
            url: `https://x.com/${author || "i"}/status/${tweetId}`,
            capturedAt: Date.now(),
            ...(Number.isFinite(likes) ? { likes } : {}),
            ...(Number.isFinite(reposts) ? { reposts } : {}),
          });
        }
        if (c.entryType === "TimelineTimelineCursor" && c.cursorType === "Bottom" && c.value) {
          nextCursor = c.value;
        }
      }
    }

    return { tweets, nextCursor };
  }

  // ---- Sync orchestrator ----
  let syncing = false;
  let stopRequested = false;

  async function syncLikes() {
    if (syncing) return { ok: false, error: "Sync already running." };
    syncing = true;
    stopRequested = false;

    if (!capturedTemplate) {
      const d = await chrome.storage.local.get(TEMPLATE_KEY);
      capturedTemplate = d[TEMPLATE_KEY] || null;
    }
    if (!capturedTemplate) {
      setStatus("Waiting for X to load the Likes request…");
      capturedTemplate = await waitForTemplate();
    }
    if (!capturedTemplate) {
      const error = "No request captured yet. Reload the likes page, then try Sync again.";
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
      const error = "Bad captured URL — refresh the likes page and try again.";
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

    setStatus(`Starting from cached total ${totalCount}…`);

    while (!stopRequested) {
      const vars = { ...variables };
      if (cursor) vars.cursor = cursor;
      url.searchParams.set("variables", JSON.stringify(vars));

      let body;
      try {
        body = await pageFetch(url.toString(), headers);
      } catch (e) {
        setStatus(`Fetch error: ${e.message}. Stopping.`);
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

      setStatus(
        `Page ${pages}: +${newThisPage} (run +${added}, total ${totalCount})`
      );

      if (!nextCursor) break;
      if (nextCursor === cursor) break;
      // If we keep getting only known tweets, assume we've caught up.
      if (consecutiveEmpty >= 3) break;
      cursor = nextCursor;

      await sleep(700); // be polite
    }

    await setState({ lastSyncAt: Date.now(), total: totalCount });
    setStatus(
      stopRequested
        ? `Stopped. Total ${totalCount} (+${added}).`
        : `Done. Total ${totalCount} (+${added}).`
    );
    syncing = false;
    return { ok: true, total: totalCount, added, stopped: stopRequested };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.source !== "xls-feed") return false;
    if (msg.type === "PING") {
      sendResponse({ ok: true, likesPage: isLikesPage(), hasTemplate: Boolean(capturedTemplate) });
      return false;
    }
    if (msg.type === "START_SYNC") {
      syncLikes()
        .then((result) => sendResponse(result || { ok: true }))
        .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
      return true;
    }
    if (msg.type === "STOP_SYNC") {
      stopRequested = true;
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  // ---- UI panel ----
  function isLikesPage() {
    return /^\/[^/]+\/likes\/?$/.test(location.pathname) || location.pathname === "/i/likes";
  }

  function setStatus(msg) {
    const el = document.querySelector("#xls-panel .xls-status");
    if (el) el.textContent = msg;
  }

  function updatePanelStatus() {
    const el = document.querySelector("#xls-panel .xls-template");
    if (!el) return;
    el.textContent = capturedTemplate ? "Request captured ✓" : "Waiting for X…";
  }

  function injectPanel() {
    if (document.getElementById("xls-panel")) return;
    const panel = document.createElement("div");
    panel.id = "xls-panel";
    panel.innerHTML = `
      <style>
        #xls-panel {
          position: fixed; right: 16px; bottom: 16px; z-index: 999999;
          background: #15202b; color: #fff; border: 1px solid #38444d;
          border-radius: 12px; padding: 10px 12px; font: 13px/1.4 -apple-system, system-ui, sans-serif;
          box-shadow: 0 4px 16px rgba(0,0,0,.4); width: 260px;
        }
        #xls-panel h4 { margin: 0 0 6px; font-size: 13px; }
        #xls-panel button {
          background: #1d9bf0; color: #fff; border: 0; border-radius: 999px;
          padding: 6px 12px; font-size: 12px; cursor: pointer; margin-right: 6px;
        }
        #xls-panel button.stop { background: #444; }
        #xls-panel .xls-template { font-size: 11px; opacity: .7; margin-top: 4px; }
        #xls-panel .xls-status { margin-top: 6px; opacity: .85; font-size: 12px; }
      </style>
      <h4>X Likes Search</h4>
      <button class="start">Sync</button>
      <button class="stop">Stop</button>
      <div class="xls-template">Waiting for X…</div>
      <div class="xls-status">Open this page (or refresh) to capture the request.</div>
    `;
    document.body.appendChild(panel);
    panel.querySelector(".start").addEventListener("click", syncLikes);
    panel.querySelector(".stop").addEventListener("click", () => (stopRequested = true));
    updatePanelStatus();
  }

  function maybeInject() {
    if (isLikesPage() && document.body) injectPanel();
  }

  // SPA route changes
  let lastUrl = location.href;
  const obs = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      maybeInject();
    }
  });
  if (document.body) obs.observe(document.body, { childList: true, subtree: true });
  else
    document.addEventListener("DOMContentLoaded", () => {
      obs.observe(document.body, { childList: true, subtree: true });
      maybeInject();
    });

  maybeInject();
})();
