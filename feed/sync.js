import {
  FEED_MESSAGE_SOURCE,
  STATE_KEY,
  STORAGE_KEY,
  SYNC_KEY,
} from "../core/constants.js";

const INDEX_REFRESH_MS = 2000;
const SYNC_RECONCILE_MS = 10000;

export function createSyncController({ state, showToast, updateStatus, applyIndex, renderCurrentMode }) {
  let syncReconcileTimer = null;
  let indexRefreshTimer = null;
  let pendingIndex = null;
  let hasPendingIndex = false;

  function sendToWorker(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ source: FEED_MESSAGE_SOURCE, ...message }, (response) => {
          void chrome.runtime?.lastError;
          resolve(response);
        });
      } catch {
        resolve(null);
      }
    });
  }

  async function toggle() {
    const button = document.querySelector("#open-likes");
    if (button && button.disabled) return;
    if (state.syncState.running) {
      await sendToWorker({ type: "STOP_SYNC" });
      showToast("Stopping sync…");
      return;
    }
    const response = await sendToWorker({ type: "START_SYNC" });
    if (!response) {
      showToast("Could not reach the extension worker");
      return;
    }
    if (!response.ok) {
      if (/no captured request/i.test(response.error || "")) {
        chrome.tabs.create({ url: "https://x.com/i/history/likes", active: true });
        showToast("Opened X Likes — let it load, then return and sync");
        return;
      }
      showToast(response.error || "Could not start sync");
      return;
    }
    showToast(response.alreadyRunning ? "Sync already running" : "Sync started");
  }

  async function refresh() {
    const response = await sendToWorker({ type: "SYNC_STATUS" });
    if (!response?.ok) return;
    state.syncState = { ...(response.state || {}) };
    state.syncState.running = Boolean(response.running);
    updateStatus();
  }

  function scheduleReconcile() {
    if (!state.syncState.running) {
      clearTimeout(syncReconcileTimer);
      syncReconcileTimer = null;
      return;
    }
    if (syncReconcileTimer) return;
    syncReconcileTimer = setTimeout(async () => {
      syncReconcileTimer = null;
      await refresh();
      scheduleReconcile();
    }, SYNC_RECONCILE_MS);
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
    if (!state.syncState.running) {
      flushPendingIndex();
      return;
    }
    if (indexRefreshTimer) return;
    indexRefreshTimer = setTimeout(flushPendingIndex, INDEX_REFRESH_MS);
  }

  async function loadIndex() {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    applyIndex(data[STORAGE_KEY] || {});
  }

  async function loadIndexState() {
    const data = await chrome.storage.local.get(STATE_KEY);
    state.indexState = data[STATE_KEY] || {};
    if (state.mode === "photos") renderCurrentMode(false);
  }

  function onStorageChanged(changes, area) {
    if (area !== "local") return;
    if (changes[SYNC_KEY]) {
      const wasRunning = state.syncState.running;
      state.syncState = changes[SYNC_KEY].newValue || {};
      updateStatus();
      if (!state.syncState.running) flushPendingIndex();
      if (state.syncState.done && state.syncState.error) showToast(state.syncState.error);
      else if (state.syncState.done && wasRunning) showToast(state.syncState.message || "Sync finished");
    }
    if (changes[STORAGE_KEY]) queueIndexRefresh(changes[STORAGE_KEY].newValue);
    if (changes[STATE_KEY]) {
      state.indexState = changes[STATE_KEY].newValue || {};
      if (state.mode === "photos") renderCurrentMode(false);
    }
  }

  function dispose() {
    clearTimeout(syncReconcileTimer);
    clearTimeout(indexRefreshTimer);
  }

  return {
    INDEX_REFRESH_MS,
    SYNC_RECONCILE_MS,
    dispose,
    loadIndex,
    loadIndexState,
    onStorageChanged,
    refresh,
    scheduleReconcile,
    toggle,
  };
}
