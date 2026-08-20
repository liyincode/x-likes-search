import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLikesCSV,
  imageExtension,
  photoDownload,
  safeFilenamePart,
} from "../../core/export.js";

function like(overrides = {}) {
  return {
    tweetId: "1001",
    text: "Hello, \"CSV\"\n第二行",
    date: "2026-08-20T08:30:00Z",
    author: { name: "李四", handle: "li_si", hue: 0, avatar: "" },
    url: "https://x.com/li_si/status/1001",
    capturedAt: 1,
    raw: {},
    searchHay: "",
    media: [{
      type: "photo",
      url: "https://pbs.twimg.com/media/example?format=png&name=small",
      width: 100,
      height: 100,
      altText: "",
    }],
    stats: { likes: 12, reposts: null },
    ...overrides,
  };
}

test("buildLikesCSV emits an Excel-friendly current-view CSV", () => {
  const csv = buildLikesCSV([like()]);
  assert.equal(csv.startsWith("\uFEFFPosted at,Display name,Username,Text"), true);
  assert.match(csv, /李四,li_si,"Hello, ""CSV""\n第二行"/);
  assert.match(csv, /https:\/\/pbs\.twimg\.com\/media\/example\?format=png&name=orig/);
  assert.match(csv, /,12,\r\n$/);
});

test("buildLikesCSV preserves input order and empty values", () => {
  const csv = buildLikesCSV([
    like({ tweetId: "2", text: "second", stats: undefined, media: undefined }),
    like({ tweetId: "1", text: "first", stats: undefined, media: [] }),
  ]);
  assert.ok(csv.indexOf("second") < csv.indexOf("first"));
  assert.match(csv, /second,https:\/\/x\.com\/li_si\/status\/1001,0,,,/);
});

test("imageExtension reads Twitter format parameters and path extensions", () => {
  assert.equal(imageExtension("https://pbs.twimg.com/media/a?format=jpeg&name=large"), "jpg");
  assert.equal(imageExtension("https://example.com/photo.webp"), "webp");
  assert.equal(imageExtension("not a url"), "jpg");
});

test("photoDownload builds a safe original-image download", () => {
  const item = {
    likedTweet: like({ tweetId: "10/01" }),
    tweet: like().mediaSource || {
      tweetId: "2001",
      text: "",
      date: "",
      author: { name: "A User", handle: "a:user", hue: 0, avatar: "" },
      url: "",
    },
    media: like().media[0],
    mediaIndex: 1,
  };
  assert.deepEqual(photoDownload(item), {
    url: "https://pbs.twimg.com/media/example?format=png&name=orig",
    filename: "x-likes-search/a-user-10-01-2.png",
  });
  assert.equal(safeFilenamePart("  ..  "), "photo");
});
