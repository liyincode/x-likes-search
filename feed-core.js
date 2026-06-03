(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FeedCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function escapeHTML(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function words(q) {
    return String(q || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  }

  function hashHue(seed) {
    const s = String(seed || "x");
    let h = 0;
    for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  }

  function normalizeLike(item) {
    const handle = item.author || "";
    const name = item.displayName || handle || "Unknown";
    const tweetId = item.tweetId || "";
    const url = item.url || (tweetId ? `https://x.com/${handle || "i"}/status/${tweetId}` : "");
    const out = {
      tweetId,
      text: item.text || "",
      date: item.datetime || "",
      author: {
        name,
        handle,
        hue: item.hue ?? hashHue(handle || name),
        avatar: item.avatar || "",
      },
      url,
      capturedAt: item.capturedAt || 0,
      raw: item,
    };
    const likes = optionalNumber(item.likes);
    const reposts = optionalNumber(item.reposts);
    if (item.media) out.media = item.media;
    if (likes !== null || reposts !== null) {
      out.stats = {
        likes,
        reposts,
      };
    }
    return out;
  }

  function optionalNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function matches(t, q) {
    const terms = words(q);
    if (!terms.length) return true;
    const hay = `${t.text || ""} ${t.author?.name || ""} ${t.author?.handle || ""}`.toLowerCase();
    return terms.every((term) => hay.includes(term));
  }

  function highlight(text, q) {
    const raw = String(text ?? "");
    const terms = words(q).sort((a, b) => b.length - a.length);
    if (!terms.length) return escapeHTML(raw);
    const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const re = new RegExp(`(${escaped.join("|")})`, "gi");
    return escapeHTML(raw).replace(re, "<mark>$1</mark>");
  }

  function sortList(list, mode) {
    const out = list.slice();
    if (mode === "oldest") {
      out.sort((a, b) => (Date.parse(a.date || "") || 0) - (Date.parse(b.date || "") || 0));
    } else if (mode === "author") {
      out.sort((a, b) =>
        (a.author.name || "").localeCompare(b.author.name || "") ||
        (Date.parse(b.date || "") || 0) - (Date.parse(a.date || "") || 0)
      );
    } else {
      out.sort((a, b) => (Date.parse(b.date || "") || 0) - (Date.parse(a.date || "") || 0));
    }
    return out;
  }

  function pipeline(all, opts) {
    let list = all.slice();
    if (opts.mediaOnly) list = list.filter((t) => t.media);
    if (opts.author && opts.author !== "all") list = list.filter((t) => t.author.handle === opts.author);
    return sortList(list, opts.sort || "newest");
  }

  function filteredView(all, opts) {
    return pipeline(all, opts).filter((t) => matches(t, opts.q));
  }

  function authors(all) {
    const seen = new Map();
    all.forEach((t) => {
      if (t.author.handle && !seen.has(t.author.handle)) seen.set(t.author.handle, t.author);
    });
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    const value = ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase();
    return value || "X";
  }

  function avatarColors(hue) {
    return {
      bg: `oklch(0.62 0.14 ${hue})`,
      bg2: `oklch(0.48 0.15 ${hue})`,
    };
  }

  function absDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return `${MON[d.getMonth()]} ${d.getDate()}`;
  }

  function relativeDate(iso, now = new Date()) {
    const then = new Date(iso).getTime();
    const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
    if (!then || Number.isNaN(then) || Number.isNaN(nowMs)) return "";
    const s = Math.max(0, Math.floor((nowMs - then) / 1000));
    if (s < 60) return "now";
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}d`;
    return absDate(iso);
  }

  function fullDate(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString();
  }

  function addHistory(existing, q) {
    const value = String(q || "").trim();
    if (value.length < 2) return existing.slice();
    const next = existing.filter((x) => x.toLowerCase() !== value.toLowerCase());
    next.unshift(value);
    return next.slice(0, 6);
  }

  function removeHistory(existing, q) {
    return existing.filter((x) => x !== q);
  }

  return {
    escapeHTML,
    normalizeLike,
    matches,
    highlight,
    sortList,
    pipeline,
    filteredView,
    authors,
    initials,
    avatarColors,
    relativeDate,
    fullDate,
    addHistory,
    removeHistory,
  };
});
