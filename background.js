// Service worker. Two jobs:
//   1. Clicking the extension icon opens (or focuses) feed.html.
//   2. Runs the Likes sync entirely here — no x.com tab required. It replays the
//      captured GraphQL request with `fetch(..., { credentials: "include" })`;
//      because the extension has host_permissions for x.com, the browser sends
//      the user's cookies, and the captured `x-csrf-token`/bearer headers make
//      the request authenticate exactly like the page's own call. This survives
//      navigation/redirects and works from the feed page with no live likes tab.

importScripts("feed-core.js", "background/sync.js", "background/runtime.js");

const FEED_URL = chrome.runtime.getURL("feed.html");
const syncEngine = XLSSync.createSyncEngine({
  storage: chrome.storage.local,
  fetchImpl: fetch.bind(globalThis),
  core: FeedCore,
});

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

XLSRuntime.registerRuntimeMessages(chrome.runtime, syncEngine);
