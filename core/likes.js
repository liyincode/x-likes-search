/**
 * @typedef {{ type: "photo", url: string, width: number, height: number, altText: string }} PhotoMedia
 * @typedef {{ tweetId: string, text: string, datetime: string | null, author: string, displayName: string, avatar: string, url: string }} MediaSourceRecord
 * @typedef {{ tweetId: string, text: string, datetime: string | null, author: string, displayName: string, avatar: string, url: string, capturedAt: number, hue?: number, likes?: number, reposts?: number, media?: PhotoMedia[], mediaSource?: MediaSourceRecord }} LikeRecord
 * @typedef {{ name: string, handle: string, hue: number, avatar: string }} ViewAuthor
 * @typedef {{ tweetId: string, text: string, date: string, author: ViewAuthor, url: string }} MediaSourceView
 * @typedef {MediaSourceView & { capturedAt: number, raw: LikeRecord, media?: PhotoMedia[], mediaSource?: MediaSourceView, stats?: { likes: number | null, reposts: number | null }, searchHay: string }} LikeView
 * @typedef {{ likedTweet: LikeView, tweet: LikeView | MediaSourceView, media: PhotoMedia, mediaIndex: number }} GalleryPhotoItem
 * @typedef {Record<string, LikeRecord>} LikeIndex
 * @typedef {{ updateMedia?: boolean }} MergeOptions
 * @typedef {{ added: number, mediaUpdated: number }} MergeResult
 */

/** @param {unknown} seed */
function hashHue(seed) {
  const value = String(seed || "x");
  let hue = 0;
  for (let i = 0; i < value.length; i += 1) {
    hue = (hue * 31 + value.charCodeAt(i)) % 360;
  }
  return hue;
}

/** @param {unknown} value */
function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * @param {LikeRecord} item
 * @returns {LikeView}
 */
export function normalizeLike(item) {
  const handle = item.author || "";
  const name = item.displayName || handle || "Unknown";
  const tweetId = item.tweetId || "";
  const url = item.url || (tweetId ? `https://x.com/${handle || "i"}/status/${tweetId}` : "");
  /** @type {LikeView} */
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
    searchHay: "",
  };
  const likes = optionalNumber(item.likes);
  const reposts = optionalNumber(item.reposts);
  if (item.media) out.media = item.media;
  if (item.mediaSource) {
    const source = item.mediaSource;
    const sourceHandle = source.author || "";
    const sourceName = source.displayName || sourceHandle || "Unknown";
    out.mediaSource = {
      tweetId: source.tweetId || "",
      text: source.text || "",
      date: source.datetime || "",
      author: {
        name: sourceName,
        handle: sourceHandle,
        hue: hashHue(sourceHandle || sourceName),
        avatar: source.avatar || "",
      },
      url: source.url || "",
    };
  }
  if (likes !== null || reposts !== null) out.stats = { likes, reposts };
  out.searchHay = `${out.text} ${name} ${handle}`.toLowerCase();
  return out;
}

/**
 * @param {unknown} url
 * @param {string} size
 */
export function mediaUrl(url, size) {
  if (String(url || "").startsWith("data:")) return String(url);
  try {
    const out = new URL(String(url));
    out.searchParams.set("name", size);
    return out.toString();
  } catch {
    return String(url || "");
  }
}

/**
 * @param {LikeView[]} tweets
 * @returns {GalleryPhotoItem[]}
 */
export function flattenPhotoItems(tweets) {
  /** @type {GalleryPhotoItem[]} */
  const items = [];
  for (const likedTweet of tweets) {
    const tweet = likedTweet.mediaSource || likedTweet;
    const media = likedTweet.media || [];
    for (let mediaIndex = 0; mediaIndex < media.length; mediaIndex += 1) {
      items.push({ likedTweet, tweet, media: media[mediaIndex], mediaIndex });
    }
  }
  return items;
}

/**
 * @param {LikeIndex} index
 * @param {LikeRecord[]} tweets
 * @param {MergeOptions} [options]
 * @returns {MergeResult}
 */
export function mergeLikes(index, tweets, options = {}) {
  const updateMedia = Boolean(options.updateMedia);
  let added = 0;
  let mediaUpdated = 0;
  for (const tweet of tweets) {
    const existing = index[tweet.tweetId];
    if (!existing) {
      index[tweet.tweetId] = tweet;
      added += 1;
      continue;
    }
    if (!updateMedia || !tweet.media?.length) continue;
    const before = JSON.stringify([existing.media || null, existing.mediaSource || null]);
    const after = JSON.stringify([tweet.media, tweet.mediaSource || null]);
    if (before === after) continue;
    const next = { ...existing, media: tweet.media, capturedAt: existing.capturedAt };
    if (tweet.mediaSource) next.mediaSource = tweet.mediaSource;
    else delete next.mediaSource;
    index[tweet.tweetId] = next;
    mediaUpdated += 1;
  }
  return { added, mediaUpdated };
}
