import { FEED_MESSAGE_SOURCE } from "../core/constants.js";

// Runtime message adapter shared by the module service worker and Node tests.

/**
 * @param {Pick<typeof chrome.runtime, "onMessage">} runtime
 * @param {ReturnType<import("./sync.js").createSyncEngine>} engine
 */
export function registerRuntimeMessages(runtime, engine) {
  runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.source !== FEED_MESSAGE_SOURCE) return false;
    if (msg.type === "START_SYNC") {
      engine.startSync().then(sendResponse);
      return true;
    }
    if (msg.type === "STOP_SYNC") {
      engine.stopSync();
      sendResponse({ ok: true });
      return false;
    }
    if (msg.type === "SYNC_STATUS") {
      engine.getStatus().then(sendResponse);
      return true;
    }
    return false;
  });
}
