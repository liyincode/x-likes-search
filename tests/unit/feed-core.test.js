import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as Core from "../../feed-core.js";
import * as fixture from "../fixtures/likes.js";

const multiPhotoFixture = JSON.parse(
  readFileSync(new URL("../fixtures/likes-multi-photo.json", import.meta.url), "utf8")
);

const likes = Object.values(fixture.index).map(Core.normalizeLike);

test("normalizes storage likes into Finder view models", () => {
  const item = Core.normalizeLike(fixture.index["1001"]);
  assert.equal(item.tweetId, "1001");
  assert.equal(item.author.name, "Devon Park");
  assert.equal(item.author.handle, "devonml");
  assert.equal(item.date, "2026-06-02T09:05:00Z");
  assert.equal(item.url, "https://x.com/devonml/status/1001");
  assert.deepEqual(item.stats, { likes: 193, reposts: 76 });
  assert.ok(Number.isFinite(item.author.hue));
  assert.ok(item.searchHay.includes("devonml"));
  assert.ok(item.searchHay.includes("claude"));
});

test("search matches text, display name, and handle with escaped highlights", () => {
  assert.equal(Core.matches(likes[0], "claude pr"), true);
  assert.equal(Core.matches(likes[0], "Devon"), true);
  assert.equal(Core.matches(likes[0], "devonml"), true);
  assert.equal(Core.matches(likes[0], "missing"), false);
  assert.equal(Core.highlight("<Claude> & PR", "claude pr"), "&lt;<mark>Claude</mark>&gt; &amp; <mark>PR</mark>");
});

test("sorts by newest, oldest, and author name", () => {
  assert.deepEqual(Core.pipeline(likes, "newest").map((t) => t.tweetId), ["1001", "1003", "1002", "1004"]);
  assert.deepEqual(Core.pipeline(likes, "oldest").map((t) => t.tweetId), ["1004", "1002", "1003", "1001"]);
  assert.deepEqual(Core.pipeline(likes, "author").map((t) => t.author.name), ["Devon Park", "Elena Rossi", "Omar Haddad", "Ren Tanaka"]);
});

test("search history dedupes and caps at six entries", () => {
  let history = [];
  ["one", "two", "three", "four", "five", "six", "seven", "two"].forEach((q) => {
    history = Core.addHistory(history, q);
  });
  assert.deepEqual(history, ["two", "seven", "six", "five", "four", "three"]);
  assert.deepEqual(Core.addHistory(history, "x"), history);
  assert.deepEqual(Core.removeHistory(history, "six"), ["two", "seven", "five", "four", "three"]);
});

test("parseLikesResponse extracts tweets, stats, and the bottom cursor", () => {
  const sample = {
    data: {
      user: {
        result: {
          timeline_v2: {
            timeline: {
              instructions: [
                {
                  type: "TimelineAddEntries",
                  entries: [
                    {
                      entryId: "tweet-1",
                      content: {
                        entryType: "TimelineTimelineItem",
                        itemContent: {
                          itemType: "TimelineTweet",
                          tweet_results: {
                            result: {
                              rest_id: "1",
                              legacy: {
                                full_text: "hello world",
                                created_at: "Wed Jun 03 10:00:00 +0000 2026",
                                favorite_count: 5,
                                retweet_count: 2,
                              },
                              core: {
                                user_results: {
                                  result: {
                                    legacy: { screen_name: "alice", name: "Alice", profile_image_url_https: "https://x/a.jpg" },
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                    { entryId: "cursor-bottom", content: { entryType: "TimelineTimelineCursor", cursorType: "Bottom", value: "CURSOR123" } },
                  ],
                },
              ],
            },
          },
        },
      },
    },
  };
  const { tweets, nextCursor, rawTweetEntryCount, instructionTypes, terminateDirection } = Core.parseLikesResponse(sample);
  assert.equal(nextCursor, "CURSOR123");
  assert.equal(tweets.length, 1);
  assert.equal(tweets[0].tweetId, "1");
  assert.equal(tweets[0].text, "hello world");
  assert.equal(tweets[0].author, "alice");
  assert.equal(tweets[0].displayName, "Alice");
  assert.equal(tweets[0].likes, 5);
  assert.equal(tweets[0].reposts, 2);
  assert.equal(tweets[0].url, "https://x.com/alice/status/1");
  assert.equal(rawTweetEntryCount, 1);
  assert.deepEqual(instructionTypes, ["TimelineAddEntries"]);
  assert.equal(terminateDirection, null);
});

test("parseLikesResponse reports timeline diagnostics without treating unparsed entries as empty", () => {
  const body = {
    data: {
      user: {
        result: {
          timeline_v2: {
            timeline: {
              instructions: [
                {
                  type: "TimelineAddEntries",
                  entries: [{
                    content: {
                      entryType: "TimelineTimelineItem",
                      itemContent: { itemType: "TimelineTweet", tweet_results: {} },
                    },
                  }],
                },
                { type: "TimelineTerminateTimeline", direction: "Bottom" },
              ],
            },
          },
        },
      },
    },
  };

  const parsed = Core.parseLikesResponse(body);

  assert.equal(parsed.rawTweetEntryCount, 1);
  assert.equal(parsed.tweets.length, 0);
  assert.deepEqual(parsed.instructionTypes, ["TimelineAddEntries", "TimelineTerminateTimeline"]);
  assert.equal(parsed.terminateDirection, "Bottom");
});

test("parseLikesResponse tolerates an empty or garbage body", () => {
  assert.deepEqual(Core.parseLikesResponse({}), {
    tweets: [],
    nextCursor: null,
    mediaFallbackCount: 0,
    timelineFound: false,
    rawTweetEntryCount: 0,
    instructionTypes: [],
    terminateDirection: null,
  });
  assert.deepEqual(Core.parseLikesResponse(null), {
    tweets: [],
    nextCursor: null,
    mediaFallbackCount: 0,
    timelineFound: false,
    rawTweetEntryCount: 0,
    instructionTypes: [],
    terminateDirection: null,
  });
  assert.deepEqual(Core.parseLikesResponse({
    data: { user: { result: { timeline_v2: { timeline: { instructions: [] } } } } },
  }), {
    tweets: [],
    nextCursor: null,
    mediaFallbackCount: 0,
    timelineFound: true,
    rawTweetEntryCount: 0,
    instructionTypes: [],
    terminateDirection: null,
  });
});

test("parseLikesResponse extracts every photo from a real sanitized multi-photo fixture", () => {
  const { tweets, mediaFallbackCount } = Core.parseLikesResponse(multiPhotoFixture);
  assert.equal(mediaFallbackCount, 0);
  assert.equal(tweets.length, 1);
  assert.equal(tweets[0].media.length, 4);
  assert.deepEqual(tweets[0].media[0], {
    type: "photo",
    url: "https://pbs.twimg.com/media/example-1.jpg",
    width: 3840,
    height: 2160,
    altText: "Example alt text 1",
  });
  assert.equal(tweets[0].media[1].altText, "");
});

test("media parsing ignores entities-only, video, and GIF entries and falls back to large dimensions", () => {
  const body = structuredClone(multiPhotoFixture);
  const legacy = body.data.user.result.timeline_v2.timeline.instructions[0].entries[0].content.itemContent.tweet_results.result.legacy;
  legacy.entities = { media: [{ type: "photo", media_url_https: "https://pbs.twimg.com/media/entities-only.jpg" }] };
  legacy.extended_entities.media[1].original_info = undefined;
  legacy.extended_entities.media.push(
    { type: "video", media_url_https: "https://pbs.twimg.com/media/video.jpg" },
    { type: "animated_gif", media_url_https: "https://pbs.twimg.com/media/gif.jpg" }
  );

  const { tweets } = Core.parseLikesResponse(body);
  assert.equal(tweets[0].media.length, 4);
  assert.deepEqual(
    { width: tweets[0].media[1].width, height: tweets[0].media[1].height },
    { width: 2048, height: 1152 }
  );
  assert.equal(tweets[0].media.some((item) => item.url.includes("entities-only")), false);
});

test("media parsing handles visibility and retweet wrappers with correct media attribution", () => {
  const visibleBody = structuredClone(multiPhotoFixture);
  const item = visibleBody.data.user.result.timeline_v2.timeline.instructions[0].entries[0].content.itemContent;
  item.tweet_results.result = { __typename: "TweetWithVisibilityResults", tweet: item.tweet_results.result };
  assert.equal(Core.parseLikesResponse(visibleBody).tweets[0].media.length, 4);

  const retweetBody = structuredClone(multiPhotoFixture);
  const retweetItem = retweetBody.data.user.result.timeline_v2.timeline.instructions[0].entries[0].content.itemContent;
  const original = retweetItem.tweet_results.result;
  retweetItem.tweet_results.result = {
    __typename: "Tweet",
    rest_id: "2000000000000000002",
    legacy: {
      full_text: "RT @example_artist: Example liked post",
      created_at: original.legacy.created_at,
      retweeted_status_result: { result: { __typename: "TweetWithVisibilityResults", tweet: original } },
    },
    core: {
      user_results: { result: { legacy: { screen_name: "reposter", name: "Reposter" } } },
    },
  };
  const parsed = Core.parseLikesResponse(retweetBody);
  assert.equal(parsed.mediaFallbackCount, 1);
  assert.equal(parsed.tweets[0].media.length, 4);
  assert.equal(parsed.tweets[0].author, "reposter");
  assert.equal(parsed.tweets[0].mediaSource.author, "example_artist");
  assert.equal(parsed.tweets[0].mediaSource.tweetId, "1000000000000000001");
});

test("mergeLikes backfills media without changing capturedAt", () => {
  const index = {
    "1": { tweetId: "1", text: "old", capturedAt: 123 },
  };
  const result = Core.mergeLikes(
    index,
    [
      { tweetId: "1", text: "new", capturedAt: 999, media: [{ type: "photo", url: "https://x/1" }] },
      { tweetId: "2", text: "added", capturedAt: 456 },
    ],
    { updateMedia: true }
  );
  assert.deepEqual(result, { added: 1, mediaUpdated: 1 });
  assert.equal(index["1"].capturedAt, 123);
  assert.equal(index["1"].text, "old");
  assert.equal(index["1"].media[0].url, "https://x/1");
});

test("gallery helpers derive CDN sizes and flatten media against its source tweet", () => {
  assert.equal(
    Core.mediaUrl("https://pbs.twimg.com/media/example.jpg?format=jpg&name=large", "small"),
    "https://pbs.twimg.com/media/example.jpg?format=jpg&name=small"
  );
  const likedTweet = Core.normalizeLike({
    tweetId: "2",
    author: "reposter",
    media: [{ type: "photo", url: "https://pbs.twimg.com/media/example.jpg" }],
    mediaSource: {
      tweetId: "1",
      text: "original",
      datetime: "2026-06-03T10:00:00Z",
      author: "artist",
      displayName: "Artist",
      url: "https://x.com/artist/status/1",
    },
  });
  const items = Core.flattenPhotoItems([likedTweet]);
  assert.equal(items.length, 1);
  assert.equal(items[0].likedTweet.tweetId, "2");
  assert.equal(items[0].tweet.author.handle, "artist");
});

test("required storage writes expose quota failures", async () => {
  const storage = {
    async set() {
      throw new Error("QUOTA_BYTES quota exceeded");
    },
  };
  await assert.rejects(
    Core.setStorageRequired(storage, { x_likes_index: {} }),
    /Local storage is full\. Sync stopped before reporting completion\./
  );
});

test("required storage writes preserve a useful generic failure", async () => {
  const storage = {
    async set() {
      throw new Error("disk unavailable");
    },
  };
  await assert.rejects(
    Core.setStorageRequired(storage, { x_likes_state: {} }),
    /Could not save sync data\. Sync stopped before reporting completion\./
  );
});

test("relative dates are stable when now is fixed", () => {
  const now = new Date("2026-06-03T12:00:00Z");
  assert.equal(Core.relativeDate("2026-06-03T11:59:40Z", now), "now");
  assert.equal(Core.relativeDate("2026-06-03T10:00:00Z", now), "2h");
  assert.equal(Core.relativeDate("2026-06-01T12:00:00Z", now), "2d");
  assert.equal(Core.relativeDate("2026-05-20T12:00:00Z", now), "May 20");
  assert.equal(Core.relativeDate("2025-05-20T12:00:00Z", now), "May 20, 2025");
  assert.equal(Core.relativeDate("2024-06-01T12:00:00Z", now), "Jun 1, 2024");
});
