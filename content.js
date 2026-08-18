// Content script. Injects inject.js into the page world at document_start and
// persists the authenticated Likes GraphQL request template it captures.

(() => {
  const TEMPLATE_KEY = "x_likes_template";

  function extensionAlive() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch (_) {
      return false;
    }
  }

  async function saveTemplate(template) {
    if (!extensionAlive()) return;
    try {
      await chrome.storage.local.set({ [TEMPLATE_KEY]: template });
    } catch (error) {
      console.warn("Could not save the captured Likes request.", error);
    }
  }

  // Register before injecting so an early page request cannot beat the bridge.
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const message = event.data;
    if (
      !message ||
      message.source !== "xls" ||
      message.type !== "TEMPLATE_CAPTURED" ||
      !message.template?.url
    ) {
      return;
    }
    void saveTemplate(message.template);
  });

  try {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("inject.js");
    script.async = false;
    (document.head || document.documentElement).appendChild(script);
    script.onload = () => script.remove();
  } catch (_) {}
})();
