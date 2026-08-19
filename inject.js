// Runs in the PAGE world (injected by content.js). Patches window.fetch and
// XMLHttpRequest so we can capture the URL + headers X uses to load the
// signed-in user's Likes timeline. Sync replay itself runs in background.js.

(() => {
  if (window.__xlsInjected) return;
  window.__xlsInjected = true;

  const LIKES_URL_RE = /\/graphql\/[^/]+\/Likes(\?|$)/;

  /** @param {{ url: string, headers: Record<string, string>, method: string }} template */
  function postCaptured(template) {
    window.postMessage(
      // Manual protocol copy shared with the classic content.js bridge.
      { source: "xls", type: "TEMPLATE_CAPTURED", template },
      "*"
    );
  }

  /** @param {HeadersInit | undefined} headers */
  function headersToObj(headers) {
    /** @type {Record<string, string>} */
    const out = {};
    if (!headers) return out;
    new Headers(headers).forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }

  // Patch fetch
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = input instanceof Request ? input.url : String(input);
      if (LIKES_URL_RE.test(url)) {
        let headers = headersToObj(init?.headers);
        if (input instanceof Request && Object.keys(headers).length === 0) {
          headers = headersToObj(input.headers);
        }
        postCaptured({
          url,
          headers,
          method: init?.method || (input instanceof Request ? input.method : "GET"),
        });
      }
    } catch (_) {}
    return origFetch(input, init);
  };

  // Patch XHR (X currently uses fetch, but be safe).
  const OrigXHR = window.XMLHttpRequest;
  class PatchedXHR extends OrigXHR {
    constructor() {
      super();
      const xhr = this;
    /** @type {Record<string, string>} */
    const headers = {};
    /** @type {XMLHttpRequest["open"]} */
    const origOpen = xhr.open;
    /** @type {XMLHttpRequest["setRequestHeader"]} */
    const origSetHeader = xhr.setRequestHeader;
    /** @type {XMLHttpRequest["send"]} */
    const origSend = xhr.send;
    let capturedUrl = "";
    let capturedMethod = "GET";
    /**
     * @param {string} method
     * @param {string | URL} url
     * @param {boolean} [async]
     * @param {string | null} [username]
     * @param {string | null} [password]
     */
    xhr.open = function (method, url, async = true, username = null, password = null) {
      capturedMethod = method;
      capturedUrl = String(url);
      const asyncFlag = typeof async === "boolean" ? async : true;
      const user = typeof username === "string" ? username : null;
      const pass = typeof password === "string" ? password : null;
      return origOpen.call(this, method, url, asyncFlag, user, pass);
    };
    /**
     * @param {string} key
     * @param {string} value
     */
    xhr.setRequestHeader = function (key, value) {
      headers[key] = value;
      return origSetHeader.call(this, key, value);
    };
    /** @param {Document | XMLHttpRequestBodyInit | null} [body] */
    xhr.send = function (body = null) {
      try {
        if (LIKES_URL_RE.test(capturedUrl)) {
          postCaptured({
            url: capturedUrl,
            headers: { ...headers },
            method: capturedMethod,
          });
        }
      } catch (_) {}
      return origSend.call(this, body);
    };
      return xhr;
    }
  }
  window.XMLHttpRequest = PatchedXHR;
})();
