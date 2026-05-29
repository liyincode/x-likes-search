// Service worker: clicking the extension icon opens (or focuses) feed.html.

const FEED_URL = chrome.runtime.getURL("feed.html");

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
