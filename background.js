// Service worker. Two jobs:
//   1. Clicking the extension icon opens (or focuses) feed.html.
//   2. Runs the Likes sync entirely here — no x.com tab required. It replays the
//      captured GraphQL request with `fetch(..., { credentials: "include" })`;
//      because the extension has host_permissions for x.com, the browser sends
//      the user's cookies, and the captured `x-csrf-token`/bearer headers make
//      the request authenticate exactly like the page's own call. This survives
//      navigation/redirects and works from the feed page with no live likes tab.

importScripts("feed-core.js");

const FEED_URL = chrome.runtime.getURL("feed.html");
const STORAGE_KEY = "x_likes_index";
const STATE_KEY = "x_likes_state";
const TEMPLATE_KEY = "x_likes_template";
const SYNC_KEY = "x_likes_sync"; // transient progress, watched by the feed page

// Backoff schedule (ms) for transient fetch failures. Length = max retries/page.
const RETRY_BACKOFF = [2000, 5000, 10000, 20000];
const PAGE_DELAY = 700; // politeness between successful pages

// ---- Toolbar click → open/focus the feed ----
chrome.action.onClicked.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: FEED_URL });
  if (tabs.length > 0) {
    const tab = tabs[0];
    await chrome.tabs.update(tab.id, { active: true });
    if (typeof tab.windowId === "number") {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } else {
    await chrome.tabs.create({ url: FEED_URL });
  }
});

// ---- Sync ----
let syncing = false;
let stopRequested = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A sleep that bails out early when the user asks to stop.
async function interruptibleSleep(ms) {
  const step = 500;
  let waited = 0;
  while (waited < ms && !stopRequested) {
    await sleep(Math.min(step, ms - waited));
    waited += step;
  }
}

async function getLocal(keys) {
  return chrome.storage.local.get(keys);
}

async function setSyncState(patch) {
  const cur = (await getLocal(SYNC_KEY))[SYNC_KEY] || {};
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ [SYNC_KEY]: next });
  return next;
}

// fetch() forbids a handful of header names; the browser sets the real values.
// Cookies arrive via credentials:"include" (host permission), so drop `cookie`
// and friends to avoid sending a stale captured value.
function sanitizeHeaders(headers) {
  const skip = new Set([
    "host",
    "cookie",
    "content-length",
    "accept-encoding",
    "connection",
    "user-agent",
    "origin",
    "referer",
  ]);
  const out = {};
  for (const k of Object.keys(headers || {})) {
    if (skip.has(k.toLowerCase())) continue;
    out[k] = headers[k];
  }
  return out;
}

// Fetch one page, retrying transient failures (network errors, 429, 5xx) with
// backoff so a single blip doesn't abort a long crawl. Permanent failures
// (401/403/404 — usually a stale template) throw immediately. Returns the parsed
// body, or throws after exhausting retries / on a permanent error / on stop.
async function fetchPage(requestUrl, method, headers, pageNum) {
  for (let attempt = 0; ; attempt += 1) {
    if (stopRequested) throw new Error("stopped");

    let res;
    try {
      res = await fetch(requestUrl, { method, headers, credentials: "include" });
    } catch (e) {
      if (attempt >= RETRY_BACKOFF.length) throw new Error(`network error: ${e.message}`);
      await setSyncState({
        running: true,
        message: `Page ${pageNum + 1}: network error — retry ${attempt + 1}/${RETRY_BACKOFF.length}…`,
      });
      await interruptibleSleep(RETRY_BACKOFF[attempt]);
      continue;
    }

    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { _raw: text };
    }

    // Treat as success if HTTP ok, or if X returned a usable GraphQL payload.
    if (res.ok || (body && body.data)) return body;

    const transient = res.status === 429 || res.status >= 500;
    if (transient && attempt < RETRY_BACKOFF.length) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : RETRY_BACKOFF[attempt];
      await setSyncState({
        running: true,
        message: `Page ${pageNum + 1}: HTTP ${res.status} — retry ${attempt + 1}/${RETRY_BACKOFF.length}…`,
      });
      await interruptibleSleep(waitMs);
      continue;
    }

    const hint =
      res.status === 401 || res.status === 403
        ? " — auth/template may be stale, refresh your X likes page once"
        : "";
    throw new Error(`HTTP ${res.status}${hint}`);
  }
}

async function startSync(requestedMode) {
  if (syncing) return { ok: true, alreadyRunning: true };
  const template = (await getLocal(TEMPLATE_KEY))[TEMPLATE_KEY];
  if (!template || !template.url) {
    return {
      ok: false,
      error:
        "No captured request yet. Open your X likes page once (refresh it) so the extension can capture the request, then try Sync.",
    };
  }
  syncing = true;
  stopRequested = false;
  // Fire and forget: the loop reports progress through chrome.storage, which the
  // feed page watches via storage.onChanged. We do NOT hold the message channel
  // open for the whole (multi-minute) sync.
  syncLoop(template, requestedMode).catch(async (e) => {
    syncing = false;
    await markIncomplete();
    await setSyncState({ running: false, done: true, complete: false, error: String((e && e.message) || e) });
  });
  return { ok: true, started: true };
}

async function markIncomplete() {
  const prev = (await getLocal(STATE_KEY))[STATE_KEY] || {};
  await chrome.storage.local.set({ [STATE_KEY]: { ...prev, completed: false } });
}

async function syncLoop(template, requestedMode) {
  let url;
  try {
    url = new URL(template.url);
  } catch {
    syncing = false;
    await setSyncState({
      running: false,
      done: true,
      complete: false,
      error: "Bad captured URL — refresh your X likes page and try again.",
    });
    return;
  }

  const headers = sanitizeHeaders(template.headers || {});
  const method = template.method || "GET";

  let variables;
  try {
    variables = JSON.parse(url.searchParams.get("variables") || "{}");
  } catch {
    variables = {};
  }

  const index = (await getLocal(STORAGE_KEY))[STORAGE_KEY] || {};
  const prevState = (await getLocal(STATE_KEY))[STATE_KEY] || {};

  // Mode resolution. "incremental" early-stops once we hit the already-known
  // top of the feed; "full" paginates to the true tail. Auto-pick "full" when
  // there's nothing indexed yet or the last run didn't finish — that self-heals
  // an interrupted crawl instead of stopping short forever.
  const empty = Object.keys(index).length === 0;
  const mode = requestedMode || (empty || !prevState.completed ? "full" : "incremental");

  let total = Object.keys(index).length;
  let added = 0;
  let pages = 0;
  let cursor = null;
  let consecutiveEmpty = 0;
  let reachedEnd = false;

  await setSyncState({
    running: true,
    done: false,
    complete: false,
    error: null,
    source: "worker",
    mode,
    page: 0,
    added: 0,
    total,
    startedAt: Date.now(),
    message: `Starting ${mode} sync…`,
  });

  while (!stopRequested) {
    const vars = { ...variables };
    if (cursor) vars.cursor = cursor;
    url.searchParams.set("variables", JSON.stringify(vars));

    let body;
    try {
      body = await fetchPage(url.toString(), method, headers, pages);
    } catch (e) {
      if (String(e.message) === "stopped") break;
      syncing = false;
      await markIncomplete();
      await setSyncState({
        running: false,
        done: true,
        complete: false,
        error: `Fetch error: ${e.message}.`,
        page: pages,
        added,
        total,
      });
      return;
    }

    if (body && body.errors && !body.data) {
      syncing = false;
      await markIncomplete();
      await setSyncState({
        running: false,
        done: true,
        complete: false,
        error: `X returned errors: ${JSON.stringify(body.errors).slice(0, 120)}…`,
        page: pages,
        added,
        total,
      });
      return;
    }

    const { tweets, nextCursor } = FeedCore.parseLikesResponse(body);
    pages += 1;

    let newThisPage = 0;
    for (const t of tweets) {
      if (!index[t.tweetId]) {
        index[t.tweetId] = t;
        added += 1;
        total += 1;
        newThisPage += 1;
      }
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: index });

    if (newThisPage === 0) consecutiveEmpty += 1;
    else consecutiveEmpty = 0;

    await setSyncState({
      running: true,
      mode,
      page: pages,
      added,
      total,
      message: `Page ${pages}: +${newThisPage} (run +${added})`,
    });

    if (!nextCursor || nextCursor === cursor) {
      reachedEnd = true;
      break;
    }
    // Incremental mode trusts that 3 known-only pages means we've caught up to
    // what we already have. Full mode keeps going to the real end.
    if (mode === "incremental" && consecutiveEmpty >= 3) {
      reachedEnd = true;
      break;
    }
    cursor = nextCursor;

    await interruptibleSleep(PAGE_DELAY);
  }

  // "completed" is true only when we walked to a natural stopping point — used
  // next run to decide whether to resume a full crawl.
  const completed = reachedEnd && !stopRequested;
  await chrome.storage.local.set({
    [STATE_KEY]: { ...prevState, lastSyncAt: Date.now(), total, completed },
  });
  syncing = false;
  await setSyncState({
    running: false,
    done: true,
    complete: completed,
    error: null,
    mode,
    page: pages,
    added,
    total,
    stopped: stopRequested,
    message: stopRequested
      ? `Stopped. +${added} (total ${total}) — sync again to finish.`
      : completed
      ? `Done. +${added} (total ${total}).`
      : `Paused. +${added} (total ${total}).`,
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.source !== "xls-feed") return false;
  if (msg.type === "START_SYNC") {
    // msg.mode is optional ("full" | "incremental"); omitted → auto.
    startSync(msg.mode).then(sendResponse);
    return true; // async response
  }
  if (msg.type === "STOP_SYNC") {
    stopRequested = true;
    sendResponse({ ok: true });
    return false;
  }
  if (msg.type === "SYNC_STATUS") {
    getLocal(SYNC_KEY).then((d) => sendResponse({ ok: true, running: syncing, state: d[SYNC_KEY] || null }));
    return true;
  }
  return false;
});
