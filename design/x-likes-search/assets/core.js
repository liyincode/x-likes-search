// Shared search / sort / filter / formatting core for all three directions.
window.Core = (function () {
  function escapeHTML(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Case-insensitive substring test across text + name + handle.
  function matches(tw, q) {
    if (!q) return true;
    q = q.toLowerCase();
    return (
      tw.text.toLowerCase().includes(q) ||
      tw.author.name.toLowerCase().includes(q) ||
      tw.author.handle.toLowerCase().includes(q)
    );
  }

  // Returns escaped HTML with <mark> around query hits.
  function highlight(text, q) {
    if (!q) return escapeHTML(text);
    const lc = text.toLowerCase();
    const lq = q.toLowerCase();
    let out = "";
    let i = 0;
    while (i < text.length) {
      const hit = lc.indexOf(lq, i);
      if (hit === -1) {
        out += escapeHTML(text.slice(i));
        break;
      }
      out += escapeHTML(text.slice(i, hit));
      out += "<mark>" + escapeHTML(text.slice(hit, hit + q.length)) + "</mark>";
      i = hit + q.length;
    }
    return out;
  }

  function sortList(list, mode) {
    const a = list.slice();
    if (mode === "oldest") a.sort((x, y) => x.date.localeCompare(y.date));
    else if (mode === "author") a.sort((x, y) => x.author.name.localeCompare(y.author.name) || y.date.localeCompare(x.date));
    else a.sort((x, y) => y.date.localeCompare(x.date)); // newest
    return a;
  }

  // Full pipeline: filter -> sort -> (search produces match flags handled by caller).
  function pipeline(all, opts) {
    let list = all.slice();
    if (opts.mediaOnly) list = list.filter((t) => t.media);
    if (opts.author && opts.author !== "all") list = list.filter((t) => t.author.handle === opts.author);
    list = sortList(list, opts.sort);
    return list;
  }

  function relativeDate(iso) {
    const then = new Date(iso).getTime();
    const now = new Date("2026-06-03T12:00:00Z").getTime();
    const s = Math.floor((now - then) / 1000);
    if (s < 60) return "now";
    const m = Math.floor(s / 60);
    if (m < 60) return m + "m";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "h";
    const d = Math.floor(h / 24);
    if (d < 7) return d + "d";
    return absDate(iso);
  }

  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  function absDate(iso) {
    const d = new Date(iso);
    return MON[d.getMonth()] + " " + d.getDate();
  }
  function fullDate(iso) {
    const d = new Date(iso);
    let h = d.getHours();
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12; if (h === 0) h = 12;
    const mm = String(d.getMinutes()).padStart(2, "0");
    return h + ":" + mm + " " + ap + " · " + MON[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
  }

  function initials(name) {
    const p = name.trim().split(/\s+/);
    return ((p[0]?.[0] || "") + (p[1]?.[0] || "")).toUpperCase();
  }

  function avatarColors(hue) {
    return {
      bg: "oklch(0.62 0.14 " + hue + ")",
      bg2: "oklch(0.48 0.15 " + hue + ")",
    };
  }

  // List of distinct authors for filter dropdowns.
  function authors(all) {
    const seen = new Map();
    all.forEach((t) => { if (!seen.has(t.author.handle)) seen.set(t.author.handle, t.author); });
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }

  return {
    escapeHTML, matches, highlight, sortList, pipeline,
    relativeDate, absDate, fullDate, initials, avatarColors, authors, plural,
  };
})();
