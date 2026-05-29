// Runs in the PAGE world (injected by content.js). Patches window.fetch and
// XMLHttpRequest so we can capture the URL + headers X uses to load the
// signed-in user's Likes timeline. Also exposes a fetch-on-demand bridge so
// the content script can replay paginated requests with the same auth context.

(() => {
  if (window.__xlsInjected) return;
  window.__xlsInjected = true;

  const LIKES_URL_RE = /\/graphql\/[^/]+\/Likes(\?|$)/;

  function postCaptured(template) {
    window.postMessage(
      { source: "xls", type: "TEMPLATE_CAPTURED", template },
      "*"
    );
  }

  function headersToObj(h) {
    const out = {};
    if (!h) return out;
    if (h instanceof Headers) {
      h.forEach((v, k) => (out[k] = v));
    } else if (Array.isArray(h)) {
      for (const [k, v] of h) out[k] = v;
    } else if (typeof h === "object") {
      Object.assign(out, h);
    }
    return out;
  }

  // Patch fetch
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url =
        typeof input === "string"
          ? input
          : input && input.url
          ? input.url
          : "";
      if (LIKES_URL_RE.test(url)) {
        let headers = headersToObj(init && init.headers);
        if (input && input.headers && Object.keys(headers).length === 0) {
          headers = headersToObj(input.headers);
        }
        postCaptured({
          url,
          headers,
          method: (init && init.method) || (input && input.method) || "GET",
        });
      }
    } catch (_) {}
    return origFetch.apply(this, arguments);
  };

  // Patch XHR (X currently uses fetch, but be safe).
  const OrigXHR = window.XMLHttpRequest;
  function PatchedXHR() {
    const xhr = new OrigXHR();
    const headers = {};
    const origOpen = xhr.open;
    const origSetHeader = xhr.setRequestHeader;
    const origSend = xhr.send;
    let capturedUrl = "";
    let capturedMethod = "GET";
    xhr.open = function (method, url) {
      capturedMethod = method;
      capturedUrl = url;
      return origOpen.apply(this, arguments);
    };
    xhr.setRequestHeader = function (k, v) {
      headers[k] = v;
      return origSetHeader.apply(this, arguments);
    };
    xhr.send = function () {
      try {
        if (LIKES_URL_RE.test(capturedUrl)) {
          postCaptured({
            url: capturedUrl,
            headers: { ...headers },
            method: capturedMethod,
          });
        }
      } catch (_) {}
      return origSend.apply(this, arguments);
    };
    return xhr;
  }
  PatchedXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = PatchedXHR;

  // Bridge: content script asks us to fetch a URL with given headers from the
  // page world (so cookies/auth context match what X expects).
  window.addEventListener("message", async (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== "xls-cmd") return;
    if (d.type === "FETCH_PAGE") {
      try {
        const res = await origFetch.call(window, d.url, {
          method: d.method || "GET",
          headers: d.headers || {},
          credentials: "include",
        });
        const text = await res.text();
        let body;
        try {
          body = JSON.parse(text);
        } catch {
          body = { _raw: text };
        }
        window.postMessage(
          {
            source: "xls",
            type: "PAGE_RESULT",
            id: d.id,
            ok: res.ok,
            status: res.status,
            body,
          },
          "*"
        );
      } catch (e) {
        window.postMessage(
          {
            source: "xls",
            type: "PAGE_RESULT",
            id: d.id,
            ok: false,
            error: String(e),
          },
          "*"
        );
      }
    }
  });
})();
