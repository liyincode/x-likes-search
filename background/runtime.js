// Classic-script runtime adapter during the staged ESM migration.
// The temporary XLSRuntime global is removed by the atomic module cutover.

((root) => {
  function registerRuntimeMessages(runtime, engine) {
    runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || msg.source !== "xls-feed") return false;
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

  root.XLSRuntime = { registerRuntimeMessages };
})(globalThis);
