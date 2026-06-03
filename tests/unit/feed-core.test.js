const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../../feed-core.js");
const fixture = require("../fixtures/likes.js");

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
});

test("search matches text, display name, and handle with escaped highlights", () => {
  assert.equal(Core.matches(likes[0], "claude pr"), true);
  assert.equal(Core.matches(likes[0], "Devon"), true);
  assert.equal(Core.matches(likes[0], "devonml"), true);
  assert.equal(Core.matches(likes[0], "missing"), false);
  assert.equal(Core.highlight("<Claude> & PR", "claude pr"), "&lt;<mark>Claude</mark>&gt; &amp; <mark>PR</mark>");
});

test("sorts and filters by newest, oldest, author, media, and author handle", () => {
  assert.deepEqual(Core.pipeline(likes, { sort: "newest" }).map((t) => t.tweetId), ["1001", "1003", "1002", "1004"]);
  assert.deepEqual(Core.pipeline(likes, { sort: "oldest" }).map((t) => t.tweetId), ["1004", "1002", "1003", "1001"]);
  assert.deepEqual(Core.pipeline(likes, { sort: "author" }).map((t) => t.author.name), ["Devon Park", "Elena Rossi", "Omar Haddad", "Ren Tanaka"]);
  assert.deepEqual(Core.pipeline(likes, { sort: "newest", author: "rentanaka" }).map((t) => t.tweetId), ["1003"]);
  assert.deepEqual(Core.pipeline(likes, { sort: "newest", mediaOnly: true }).map((t) => t.tweetId), []);
});

test("authors are unique and sorted", () => {
  assert.deepEqual(Core.authors(likes).map((a) => a.handle), ["devonml", "elenacodes", "omarml", "rentanaka"]);
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

test("relative dates are stable when now is fixed", () => {
  const now = new Date("2026-06-03T12:00:00Z");
  assert.equal(Core.relativeDate("2026-06-03T11:59:40Z", now), "now");
  assert.equal(Core.relativeDate("2026-06-03T10:00:00Z", now), "2h");
  assert.equal(Core.relativeDate("2026-06-01T12:00:00Z", now), "2d");
  assert.equal(Core.relativeDate("2026-05-20T12:00:00Z", now), "May 20");
});
