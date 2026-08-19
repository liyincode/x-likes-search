import {
  INDEX_VERSION,
  STATE_KEY,
  STORAGE_KEY,
  SYNC_KEY,
  TEMPLATE_KEY,
} from "../core/constants.js";
import { mergeLikes } from "../core/likes.js";
import { setStorageRequired } from "../core/storage.js";
import { parseLikesResponse } from "../core/x-likes-parser.js";

// DOM-free sync engine shared by the module service worker and Node tests.

export function createSyncEngine(dependencies) {
  const storage = dependencies.storage;
  const fetchImpl = dependencies.fetchImpl;
  const now = dependencies.now || Date.now;
  const logger = dependencies.logger || console;
  const setTimeoutImpl = dependencies.setTimeoutImpl || setTimeout;
  const clearTimeoutImpl = dependencies.clearTimeoutImpl || clearTimeout;
  const retryBackoff = dependencies.retryBackoff || [2000, 5000, 10000, 20000];
  const fetchTimeoutMs = dependencies.fetchTimeoutMs ?? 30000;
  const pageDelayMs = dependencies.pageDelayMs ?? 700;
  const tailConfirmDelayMs = dependencies.tailConfirmDelayMs ?? 1000;

let syncing = false;
let stopRequested = false;
let liveSyncState = null;
let activeFetchController = null;

const sleep = (ms) => new Promise((r) => setTimeoutImpl(r, ms));

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
  return storage.get(keys);
}

async function setLocalRequired(items) {
  return setStorageRequired(storage, items);
}

function updateLiveSyncState(patch) {
  liveSyncState = { ...(liveSyncState || {}), ...patch };
  return liveSyncState;
}

async function setSyncState(patch) {
  const cur = liveSyncState || (await getLocal(SYNC_KEY))[SYNC_KEY] || {};
  const next = { ...cur, ...patch };
  liveSyncState = next;
  await setLocalRequired({ [SYNC_KEY]: next });
  return next;
}

async function reportSyncFailure(error) {
  syncing = false;
  const message = String(error?.message || error || "Sync failed.");
  const next = updateLiveSyncState({
    running: false,
    done: true,
    complete: false,
    error: message,
    message,
  });
  try {
    await markIncomplete();
  } catch (stateError) {
    logger.error("Could not mark the interrupted sync as incomplete.", stateError);
  }
  try {
    await storage.set({ [SYNC_KEY]: next });
  } catch (syncStateError) {
    logger.error("Could not persist the final sync error state.", syncStateError);
  }
}

async function currentSyncStatus() {
  if (liveSyncState) return { ok: true, running: syncing, state: liveSyncState };
  const stored = (await getLocal(SYNC_KEY))[SYNC_KEY] || null;
  if (stored?.running) {
    const message = "Sync was interrupted. Start it again to continue.";
    const interrupted = {
      ...stored,
      running: false,
      done: true,
      complete: false,
      error: message,
      message,
    };
    liveSyncState = interrupted;
    try {
      await storage.set({ [SYNC_KEY]: interrupted });
    } catch (error) {
      logger.error("Could not persist the interrupted sync state.", error);
    }
    return { ok: true, running: false, state: interrupted };
  }
  liveSyncState = stored;
  return { ok: true, running: false, state: stored };
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
    let text;
    const controller = new AbortController();
    activeFetchController = controller;
    const timeoutId = setTimeoutImpl(() => controller.abort(), fetchTimeoutMs);
    try {
      res = await fetchImpl(requestUrl, {
        method,
        headers,
        credentials: "include",
        signal: controller.signal,
      });
      text = await res.text();
    } catch (e) {
      if (stopRequested) throw new Error("stopped");
      const failure = e?.name === "AbortError" ? "request timed out" : `network error: ${e.message}`;
      if (attempt >= retryBackoff.length) throw new Error(failure);
      await setSyncState({
        running: true,
        message: `Page ${pageNum + 1} · ${failure} · retry ${attempt + 1}/${retryBackoff.length}…`,
      });
      await interruptibleSleep(retryBackoff[attempt]);
      continue;
    } finally {
      clearTimeoutImpl(timeoutId);
      if (activeFetchController === controller) activeFetchController = null;
    }

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { _raw: text };
    }

    // Treat as success if HTTP ok, or if X returned a usable GraphQL payload.
    if (res.ok || (body && body.data)) return body;

    const transient = res.status === 429 || res.status >= 500;
    if (transient && attempt < retryBackoff.length) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : retryBackoff[attempt];
      await setSyncState({
        running: true,
        message: `Page ${pageNum + 1}: HTTP ${res.status} — retry ${attempt + 1}/${retryBackoff.length}…`,
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

async function startSync() {
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
  syncLoop(template).catch(reportSyncFailure);
  return { ok: true, started: true };
}

async function markIncomplete() {
  const prev = (await getLocal(STATE_KEY))[STATE_KEY] || {};
  await setLocalRequired({ [STATE_KEY]: { ...prev, completed: false } });
}

async function syncLoop(template) {
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
  const templateHasCursor = Object.hasOwn(variables, "cursor");
  const baseVariables = { ...variables };
  delete baseVariables.cursor;

  const index = (await getLocal(STORAGE_KEY))[STORAGE_KEY] || {};
  const prevState = (await getLocal(STATE_KEY))[STATE_KEY] || {};

  const needsMediaBackfill = Number(prevState.indexVersion || 0) < INDEX_VERSION;

  let total = Object.keys(index).length;
  let added = 0;
  let mediaUpdated = 0;
  let mediaFallbacks = 0;
  let removed = 0;
  let pages = 0;
  let cursor = null;
  let reachedTail = false;
  let repeatedCursor = false;
  let confirmingEmptyFixedPoint = false;
  const seenTweetIds = new Set();

  const initialSyncState = {
    running: true,
    done: false,
    complete: false,
    error: null,
    page: 0,
    added: 0,
    mediaUpdated: 0,
    removed: 0,
    total,
    stopped: false,
    startedAt: now(),
    checked: 0,
    message: "Preparing request…",
  };
  liveSyncState = initialSyncState;
  await setLocalRequired({ [SYNC_KEY]: initialSyncState });

  while (!stopRequested) {
    const vars = { ...baseVariables };
    if (cursor) vars.cursor = cursor;
    url.searchParams.set("variables", JSON.stringify(vars));

    let body;
    try {
      body = await fetchPage(url.toString(), method, headers, pages);
    } catch (e) {
      if (String(e.message) === "stopped") break;
      if (e?.code === "XLS_STORAGE_WRITE") throw e;
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

    const {
      tweets,
      nextCursor,
      mediaFallbackCount,
      timelineFound,
      rawTweetEntryCount,
      instructionTypes,
      terminateDirection,
    } = parseLikesResponse(body);
    const seenBeforePage = seenTweetIds.size;
    if (timelineFound) {
      for (const tweet of tweets) seenTweetIds.add(tweet.tweetId);
    }
    const newSeenCount = seenTweetIds.size - seenBeforePage;
    logger.debug("Likes sync page", {
      page: pages + 1,
      templateHasCursor,
      requestCursorPresent: Boolean(cursor),
      cursorAdvanced: Boolean(nextCursor && nextCursor !== cursor),
      instructionTypes,
      rawTweetEntryCount,
      parsedTweetCount: tweets.length,
      unparsedTweetEntryCount: Math.max(0, rawTweetEntryCount - tweets.length),
      newSeenCount,
      terminateDirection,
    });
    if (!timelineFound) {
      syncing = false;
      await markIncomplete();
      await setSyncState({
        running: false,
        done: true,
        complete: false,
        error: "Could not find the Likes timeline in X's response. No local likes were removed.",
        page: pages,
        added,
        removed: 0,
        total,
      });
      return;
    }
    pages += 1;
    mediaFallbacks += mediaFallbackCount;

    const merged = mergeLikes(index, tweets, { updateMedia: needsMediaBackfill });
    added += merged.added;
    mediaUpdated += merged.mediaUpdated;
    total += merged.added;
    await setLocalRequired({ [STORAGE_KEY]: index });

    await setSyncState({
      running: true,
      page: pages,
      added,
      mediaUpdated,
      checked: seenTweetIds.size,
      total,
      message: `Page ${pages} · ${seenTweetIds.size} checked · +${added}`,
    });

    if (!nextCursor) {
      reachedTail = true;
      break;
    }
    const emptyCursorFixedPoint =
      nextCursor === cursor &&
      rawTweetEntryCount === 0 &&
      tweets.length === 0 &&
      newSeenCount === 0;
    if (emptyCursorFixedPoint) {
      if (confirmingEmptyFixedPoint) {
        reachedTail = true;
        break;
      }
      confirmingEmptyFixedPoint = true;
      await setSyncState({
        running: true,
        message: `Page ${pages} · confirming end of likes…`,
      });
      await interruptibleSleep(tailConfirmDelayMs);
      continue;
    }
    if (nextCursor === cursor) {
      repeatedCursor = true;
      break;
    }
    confirmingEmptyFixedPoint = false;
    cursor = nextCursor;

    await interruptibleSleep(pageDelayMs);
  }

  // Absence is deletion evidence only after a recognized response was traversed
  // from the first page to a true tail. Repeated cursors, failures, and user
  // stops never remove local records.
  if (reachedTail && !stopRequested) {
    for (const tweetId of Object.keys(index)) {
      if (seenTweetIds.has(tweetId)) continue;
      delete index[tweetId];
      removed += 1;
    }
    if (removed > 0) {
      total = Object.keys(index).length;
      await setLocalRequired({ [STORAGE_KEY]: index });
    }
  }

  const completed = reachedTail && !stopRequested;
  const nextState = { ...prevState, lastSyncAt: now(), total, completed };
  if (reachedTail && !stopRequested && needsMediaBackfill) {
    nextState.indexVersion = INDEX_VERSION;
  }
  await setLocalRequired({
    [STATE_KEY]: nextState,
  });
  syncing = false;
  if (mediaFallbacks > 0) {
    logger.warn(`Used retweet media fallback for ${mediaFallbacks} liked posts.`);
  }
  await setSyncState({
    running: false,
    done: true,
    complete: completed,
    error: repeatedCursor
      ? "Sync stopped before reaching the end of your likes. Nothing was removed — try again in a moment."
      : null,
    page: pages,
    added,
    mediaUpdated,
    mediaFallbacks,
    removed,
    checked: seenTweetIds.size,
    total,
    stopped: stopRequested,
    message: stopRequested
      ? `Stopped. +${added} (total ${total}) — sync again to finish.`
      : completed
      ? `Done. +${added}, -${removed} (total ${total}).`
      : repeatedCursor
      ? "Sync stopped before reaching the end of your likes. Nothing was removed — try again in a moment."
      : `Paused. +${added} (total ${total}).`,
  });
}



  function stopSync() {
    stopRequested = true;
    activeFetchController?.abort();
  }

  async function getStatus() {
    try {
      return await currentSyncStatus();
    } catch (error) {
      return {
        ok: false,
        running: syncing,
        state: liveSyncState,
        error: String(error?.message || error),
      };
    }
  }

  return { startSync, stopSync, getStatus };
}
