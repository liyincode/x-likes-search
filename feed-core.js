(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FeedCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : window, function () {
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Virtual list row heights (px) — tuned to match .row / .row.active in feed.css.
  const ROW_COLLAPSED = 56;
  const ROW_ACTIVE_EXPANDED = 128;

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
    out.searchHay = `${out.text} ${name} ${handle}`.toLowerCase();
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
    const hay =
      t.searchHay ||
      `${t.text || ""} ${t.author?.name || ""} ${t.author?.handle || ""}`.toLowerCase();
    return terms.every((term) => hay.includes(term));
  }

  function countMatches(list, q) {
    const terms = words(q);
    if (!terms.length) return list.length;
    let n = 0;
    for (let i = 0; i < list.length; i += 1) {
      if (matches(list[i], q)) n += 1;
    }
    return n;
  }

  function buildRowOffsets(count, activeIndex, collapsed = ROW_COLLAPSED, expanded = ROW_ACTIVE_EXPANDED) {
    const tops = new Array(count);
    const heights = new Array(count);
    let y = 0;
    for (let i = 0; i < count; i += 1) {
      tops[i] = y;
      const h = activeIndex >= 0 && i === activeIndex ? expanded : collapsed;
      heights[i] = h;
      y += h;
    }
    return { tops, heights, totalHeight: y };
  }

  function visibleRange(scrollTop, viewportHeight, layout, overscan = 5) {
    const { tops, heights, totalHeight } = layout;
    const count = tops.length;
    if (!count) return { start: 0, end: -1, totalHeight: 0 };

    let start = 0;
    let lo = 0;
    let hi = count - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (tops[mid] + heights[mid] > scrollTop) {
        start = mid;
        hi = mid - 1;
      } else lo = mid + 1;
    }
    start = Math.max(0, start - overscan);

    const bottom = scrollTop + viewportHeight;
    let end = 0;
    lo = 0;
    hi = count - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (tops[mid] < bottom) {
        end = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    end = Math.min(count - 1, end + overscan);

    return { start, end, totalHeight };
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

  function pipeline(all, sort = "newest") {
    return sortList(all, sort);
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

  function absDate(iso, now = new Date()) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const nowD = now instanceof Date ? now : new Date(now);
    const label = `${MON[d.getMonth()]} ${d.getDate()}`;
    if (!Number.isNaN(nowD.getTime()) && d.getFullYear() !== nowD.getFullYear()) {
      return `${label}, ${d.getFullYear()}`;
    }
    return label;
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
    return absDate(iso, now);
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

  // Walk X's GraphQL Likes timeline `instructions`/`entries` to extract the
  // tweets on this page plus the bottom pagination cursor. Single source of
  // truth shared by content.js (page-world capture) and background.js (the
  // service-worker sync). Defensive optional-chaining handles X reshaping its
  // response (legacy vs core, note_tweet vs full_text). This is the most likely
  // thing to need an update when extraction breaks — update it here only.
  function parseLikesResponse(body) {
    const tweets = [];
    let nextCursor = null;

    const timeline =
      body?.data?.user?.result?.timeline_v2?.timeline ||
      body?.data?.user?.result?.timeline?.timeline ||
      null;
    const instructions = timeline?.instructions || [];

    for (const ins of instructions) {
      if (ins.type === "TimelineReplaceEntry" && ins.entry) {
        const c = ins.entry.content || {};
        if (c.entryType === "TimelineTimelineCursor" && c.cursorType === "Bottom" && c.value) {
          nextCursor = c.value;
        }
      }
      const entries = ins.entries || [];
      for (const entry of entries) {
        const c = entry.content || {};
        if (c.entryType === "TimelineTimelineItem" && c.itemContent?.itemType === "TimelineTweet") {
          let res = c.itemContent.tweet_results?.result;
          if (!res) continue;
          if (res.__typename === "TweetWithVisibilityResults" && res.tweet) res = res.tweet;
          const tweetId = res.rest_id || res.legacy?.id_str;
          if (!tweetId) continue;
          const text =
            res.note_tweet?.note_tweet_results?.result?.text ||
            res.legacy?.full_text ||
            "";
          const datetime = res.legacy?.created_at || null;
          const userRes = res.core?.user_results?.result;
          const author =
            userRes?.legacy?.screen_name || userRes?.core?.screen_name || "";
          const displayName =
            userRes?.legacy?.name || userRes?.core?.name || "";
          const avatar =
            userRes?.legacy?.profile_image_url_https ||
            userRes?.avatar?.image_url ||
            "";
          const likes = res.legacy?.favorite_count;
          const reposts = res.legacy?.retweet_count;
          tweets.push({
            tweetId,
            text,
            datetime,
            author,
            displayName,
            avatar,
            url: `https://x.com/${author || "i"}/status/${tweetId}`,
            capturedAt: Date.now(),
            ...(Number.isFinite(likes) ? { likes } : {}),
            ...(Number.isFinite(reposts) ? { reposts } : {}),
          });
        }
        if (c.entryType === "TimelineTimelineCursor" && c.cursorType === "Bottom" && c.value) {
          nextCursor = c.value;
        }
      }
    }

    return { tweets, nextCursor };
  }

  return {
    escapeHTML,
    normalizeLike,
    matches,
    countMatches,
    ROW_COLLAPSED,
    ROW_ACTIVE_EXPANDED,
    buildRowOffsets,
    visibleRange,
    highlight,
    sortList,
    pipeline,
    initials,
    avatarColors,
    relativeDate,
    fullDate,
    addHistory,
    removeHistory,
    parseLikesResponse,
  };
});
