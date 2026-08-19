import { escapeHTML } from "./format.js";

/** @typedef {import("./likes.js").LikeView} LikeView */
/** @typedef {"newest" | "oldest" | "author"} SortMode */

/** @param {string} query */
function words(query) {
  return String(query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * @param {LikeView} tweet
 * @param {string} query
 */
export function matches(tweet, query) {
  const terms = words(query);
  if (!terms.length) return true;
  const hay = tweet.searchHay ||
    `${tweet.text || ""} ${tweet.author?.name || ""} ${tweet.author?.handle || ""}`.toLowerCase();
  return terms.every((term) => hay.includes(term));
}

/**
 * @param {LikeView[]} list
 * @param {string} query
 */
export function countMatches(list, query) {
  const terms = words(query);
  if (!terms.length) return list.length;
  let count = 0;
  for (let i = 0; i < list.length; i += 1) {
    if (matches(list[i], query)) count += 1;
  }
  return count;
}

/**
 * @param {unknown} text
 * @param {string} query
 */
export function highlight(text, query) {
  const raw = String(text ?? "");
  const terms = words(query).sort((a, b) => b.length - a.length);
  if (!terms.length) return escapeHTML(raw);
  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escaped.join("|")})`, "gi");
  return escapeHTML(raw).replace(pattern, "<mark>$1</mark>");
}

/**
 * @param {LikeView[]} list
 * @param {SortMode} mode
 */
export function sortList(list, mode) {
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

/**
 * @param {LikeView[]} all
 * @param {SortMode} [sort]
 */
export function pipeline(all, sort = "newest") {
  return sortList(all, sort);
}

/**
 * @param {string[]} existing
 * @param {string} query
 */
export function addHistory(existing, query) {
  const value = String(query || "").trim();
  if (value.length < 2) return existing.slice();
  const next = existing.filter((item) => item.toLowerCase() !== value.toLowerCase());
  next.unshift(value);
  return next.slice(0, 6);
}

/**
 * @param {string[]} existing
 * @param {string} query
 */
export function removeHistory(existing, query) {
  return existing.filter((item) => item !== query);
}
