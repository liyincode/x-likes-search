/** @typedef {import("./likes.js").LikeRecord} LikeRecord */
/** @typedef {import("./likes.js").MediaSourceRecord} MediaSourceRecord */
/** @typedef {import("./likes.js").PhotoMedia} PhotoMedia */
/** @typedef {import("../types/x-api.js").LikesResponse} LikesResponse */
/** @typedef {import("../types/x-api.js").XTweet} XTweet */
/** @typedef {import("../types/x-api.js").XTweetResult} XTweetResult */

/**
 * @typedef {{
 *   tweets: LikeRecord[],
 *   nextCursor: string | null,
 *   mediaFallbackCount: number,
 *   timelineFound: boolean,
 *   rawTweetEntryCount: number,
 *   instructionTypes: string[],
 *   terminateDirection: string | null,
 * }} ParsedLikes
 */

// Walk X's GraphQL Likes timeline to extract tweets and the bottom cursor.
// Keep this defensive because X can reshape legacy/core and visibility wrappers.
/**
 * @param {unknown} body
 * @returns {ParsedLikes}
 */
export function parseLikesResponse(body) {
  /** @type {LikeRecord[]} */
  const tweets = [];
  let nextCursor = null;
  let mediaFallbackCount = 0;
  let rawTweetEntryCount = 0;
  let terminateDirection = null;
  /** @type {string[]} */
  const instructionTypes = [];

  const payload = /** @type {LikesResponse | null | undefined} */ (body);
  const timeline =
    payload?.data?.user?.result?.timeline_v2?.timeline ||
    payload?.data?.user?.result?.timeline?.timeline ||
    null;
  const instructions = timeline?.instructions;
  const timelineFound = Array.isArray(instructions);

  for (const instruction of instructions || []) {
    if (typeof instruction.type === "string" && !instructionTypes.includes(instruction.type)) {
      instructionTypes.push(instruction.type);
    }
    if (instruction.type === "TimelineTerminateTimeline" && typeof instruction.direction === "string") {
      terminateDirection = instruction.direction;
    }
    if (instruction.type === "TimelineReplaceEntry" && instruction.entry) {
      const content = instruction.entry.content;
      if (content?.entryType === "TimelineTimelineCursor" && content.cursorType === "Bottom" && content.value) {
        nextCursor = content.value;
      }
    }
    for (const entry of instruction.entries || []) {
      const content = entry.content;
      if (content?.entryType === "TimelineTimelineItem" && content.itemContent?.itemType === "TimelineTweet") {
        rawTweetEntryCount += 1;
        const result = unwrapVisibilityResult(content.itemContent.tweet_results?.result);
        if (!result) continue;
        const tweetId = result.rest_id || result.legacy?.id_str;
        if (!tweetId) continue;
        const text = result.note_tweet?.note_tweet_results?.result?.text || result.legacy?.full_text || "";
        const datetime = result.legacy?.created_at || null;
        const userResult = result.core?.user_results?.result;
        const author = userResult?.legacy?.screen_name || userResult?.core?.screen_name || "";
        const displayName = userResult?.legacy?.name || userResult?.core?.name || "";
        const avatar = userResult?.legacy?.profile_image_url_https || userResult?.avatar?.image_url || "";
        const likes = result.legacy?.favorite_count;
        const reposts = result.legacy?.retweet_count;
        const mediaResult = extractPhotoMedia(result);
        if (mediaResult.fallback) mediaFallbackCount += 1;
        /** @type {LikeRecord} */
        const tweet = {
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
          ...(mediaResult.media.length ? { media: mediaResult.media } : {}),
        };
        if (mediaResult.fallback && mediaResult.source) {
          tweet.mediaSource = tweetIdentity(mediaResult.source);
        }
        tweets.push(tweet);
      }
      if (content?.entryType === "TimelineTimelineCursor" && content.cursorType === "Bottom" && content.value) {
        nextCursor = content.value;
      }
    }
  }

  return {
    tweets,
    nextCursor,
    mediaFallbackCount,
    timelineFound,
    rawTweetEntryCount,
    instructionTypes,
    terminateDirection,
  };
}

/**
 * @param {XTweetResult | null | undefined} result
 * @returns {XTweet | undefined}
 */
function unwrapVisibilityResult(result) {
  if (result && "tweet" in result && result.__typename === "TweetWithVisibilityResults" && result.tweet) {
    return result.tweet;
  }
  return /** @type {XTweet | undefined} */ (result);
}

/**
 * @param {XTweet} result
 * @returns {MediaSourceRecord}
 */
function tweetIdentity(result) {
  const tweetId = result?.rest_id || result?.legacy?.id_str || "";
  const legacy = result?.legacy || {};
  const user = result?.core?.user_results?.result;
  const author = user?.legacy?.screen_name || user?.core?.screen_name || "";
  return {
    tweetId,
    text: result?.note_tweet?.note_tweet_results?.result?.text || legacy.full_text || "",
    datetime: legacy.created_at || null,
    author,
    displayName: user?.legacy?.name || user?.core?.name || "",
    avatar: user?.legacy?.profile_image_url_https || user?.avatar?.image_url || "",
    url: `https://x.com/${author || "i"}/status/${tweetId}`,
  };
}

/**
 * @param {XTweet} result
 * @returns {{ media: PhotoMedia[], fallback: boolean, source: XTweet | null }}
 */
function extractPhotoMedia(result) {
  const outer = result?.legacy;
  let source = result;
  let legacy = outer;
  let fallback = false;
  if (!outer?.extended_entities?.media?.length) {
    const retweet = unwrapVisibilityResult(outer?.retweeted_status_result?.result);
    if (retweet?.legacy?.extended_entities?.media?.length) {
      source = retweet;
      legacy = retweet.legacy;
      fallback = true;
    }
  }
  const media = (legacy?.extended_entities?.media || [])
    .filter((item) => item?.type === "photo" && item.media_url_https)
    .map((item) => {
      const width = Number(item.original_info?.width ?? item.sizes?.large?.w);
      const height = Number(item.original_info?.height ?? item.sizes?.large?.h);
      return {
        type: /** @type {const} */ ("photo"),
        url: String(item.media_url_https),
        width: Number.isFinite(width) ? width : 0,
        height: Number.isFinite(height) ? height : 0,
        altText: item.ext_alt_text || "",
      };
    });
  return { media, fallback, source: fallback ? source : null };
}
