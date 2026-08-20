import { mediaUrl } from "./likes.js";

/** @typedef {import("./likes.js").GalleryPhotoItem} GalleryPhotoItem */
/** @typedef {import("./likes.js").LikeView} LikeView */

const CSV_HEADERS = [
  "Posted at",
  "Display name",
  "Username",
  "Text",
  "Tweet URL",
  "Photo count",
  "Photo URLs",
  "Likes",
  "Reposts",
];

const IMAGE_EXTENSIONS = new Set(["gif", "jpeg", "jpg", "png", "webp"]);

/** @param {unknown} value */
function csvField(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * @param {LikeView[]} likes
 * @returns {string}
 */
export function buildLikesCSV(likes) {
  const rows = likes.map((tweet) => {
    const photos = tweet.media || [];
    return [
      tweet.date,
      tweet.author.name,
      tweet.author.handle,
      tweet.text,
      tweet.url,
      photos.length,
      photos.map((item) => mediaUrl(item.url, "orig")).join(" | "),
      tweet.stats?.likes,
      tweet.stats?.reposts,
    ].map(csvField).join(",");
  });
  return `\uFEFF${[CSV_HEADERS.join(","), ...rows].join("\r\n")}\r\n`;
}

/** @param {unknown} value */
export function safeFilenamePart(value) {
  const normalized = String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[. -]+|[. -]+$/g, "")
    .slice(0, 64);
  return normalized || "photo";
}

/** @param {string} url */
export function imageExtension(url) {
  try {
    const parsed = new URL(url);
    const format = (parsed.searchParams.get("format") || "").toLowerCase();
    if (IMAGE_EXTENSIONS.has(format)) return format === "jpeg" ? "jpg" : format;
    const extension = parsed.pathname.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase() || "";
    if (IMAGE_EXTENSIONS.has(extension)) return extension === "jpeg" ? "jpg" : extension;
  } catch (_) {}
  return "jpg";
}

/** @param {GalleryPhotoItem} item */
export function photoDownload(item) {
  const url = mediaUrl(item.media.url, "orig");
  const handle = safeFilenamePart(item.tweet.author.handle || item.tweet.author.name);
  const tweetId = safeFilenamePart(item.likedTweet.tweetId);
  const suffix = item.mediaIndex + 1;
  const extension = imageExtension(url);
  return {
    url,
    filename: `x-likes-search/${handle}-${tweetId}-${suffix}.${extension}`,
  };
}
