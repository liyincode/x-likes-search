const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const Core = require("../../feed-core.js");

const source = fs.readFileSync(path.resolve(__dirname, "../../background.js"), "utf8");

function responseBody() {
  return {
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
                      content: {
                        entryType: "TimelineTimelineItem",
                        itemContent: {
                          itemType: "TimelineTweet",
                          tweet_results: {
                            result: {
                              rest_id: "1",
                              legacy: {
                                full_text: "one",
                                created_at: "Wed Jun 03 10:00:00 +0000 2026",
                              },
                              core: {
                                user_results: {
                                  result: { legacy: { screen_name: "alice", name: "Alice" } },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    },
  };
}

function createHarness(initialStore, setImpl, fetchBody = responseBody()) {
  const store = structuredClone(initialStore);
  let messageListener;
  const writes = [];
  const chrome = {
    runtime: {
      getURL: (file) => `chrome-extension://test/${file}`,
      onMessage: { addListener(fn) { messageListener = fn; } },
    },
    action: { onClicked: { addListener() {} } },
    tabs: { async query() { return []; }, async update() {}, async create() {} },
    windows: { async update() {} },
    storage: {
      local: {
        async get(keys) {
          const out = {};
          for (const key of Array.isArray(keys) ? keys : [keys]) out[key] = structuredClone(store[key]);
          return out;
        },
        async set(items) {
          writes.push(structuredClone(items));
          if (setImpl) await setImpl(items);
          Object.assign(store, structuredClone(items));
        },
      },
    },
  };
  const context = {
    chrome,
    FeedCore: Core,
    importScripts() {},
    fetch: async () => ({
      ok: true,
      status: 200,
      headers: { get() { return null; } },
      async text() { return JSON.stringify(fetchBody); },
    }),
    URL,
    console,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(source, context, { filename: "background.js" });

  function send(message) {
    return new Promise((resolve) => {
      const async = messageListener(message, {}, resolve);
      if (!async) queueMicrotask(() => resolve(undefined));
    });
  }

  return { store, writes, send };
}

test("worker sync stops and reports an index quota failure", async () => {
  const templateUrl = new URL("https://x.com/i/api/graphql/hash/Likes");
  templateUrl.searchParams.set("variables", "{}");
  const harness = createHarness(
    {
      x_likes_template: { url: templateUrl.toString(), headers: {}, method: "GET" },
      x_likes_index: {},
      x_likes_state: { completed: false },
    },
    async (items) => {
      if (Object.hasOwn(items, "x_likes_index")) throw new Error("QUOTA_BYTES quota exceeded");
    }
  );

  const started = await harness.send({ source: "xls-feed", type: "START_SYNC" });
  assert.equal(started.ok, true);
  assert.equal(started.started, true);

  let status;
  for (let i = 0; i < 20; i += 1) {
    status = await harness.send({ source: "xls-feed", type: "SYNC_STATUS" });
    if (status?.state?.done) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(status.running, false);
  assert.equal(status.state.complete, false);
  assert.match(status.state.error, /Local storage is full/);
  assert.equal(harness.store.x_likes_index["1"], undefined);
  assert.equal(harness.store.x_likes_state.completed, false);
  assert.equal(harness.store.x_likes_state.indexVersion, undefined);
});

test("worker forces a full media backfill and upgrades the index only at the natural end", async () => {
  const templateUrl = new URL("https://x.com/i/api/graphql/hash/Likes");
  templateUrl.searchParams.set("variables", "{}");
  const body = responseBody();
  const result = body.data.user.result.timeline_v2.timeline.instructions[0].entries[0].content.itemContent.tweet_results.result;
  result.legacy.extended_entities = {
    media: [{
      type: "photo",
      media_url_https: "https://pbs.twimg.com/media/example.jpg",
      original_info: { width: 1200, height: 800 },
    }],
  };
  const harness = createHarness({
    x_likes_template: { url: templateUrl.toString(), headers: {}, method: "GET" },
    x_likes_index: {
      "1": { tweetId: "1", text: "existing", capturedAt: 123 },
    },
    x_likes_state: { completed: true, indexVersion: 1 },
  }, null, body);

  await harness.send({ source: "xls-feed", type: "START_SYNC", mode: "incremental" });
  let status;
  for (let i = 0; i < 20; i += 1) {
    status = await harness.send({ source: "xls-feed", type: "SYNC_STATUS" });
    if (status?.state?.done) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(status.state.mode, "full");
  assert.equal(status.state.mediaUpdated, 1);
  assert.equal(harness.store.x_likes_index["1"].capturedAt, 123);
  assert.equal(harness.store.x_likes_index["1"].media.length, 1);
  assert.equal(harness.store.x_likes_state.completed, true);
  assert.equal(harness.store.x_likes_state.indexVersion, Core.INDEX_VERSION);
});

test("worker reconciles a stale persisted running state after restart", async () => {
  const harness = createHarness({
    x_likes_sync: { running: true, source: "worker", message: "Page 3" },
  });

  const status = await harness.send({ source: "xls-feed", type: "SYNC_STATUS" });

  assert.equal(status.running, false);
  assert.equal(status.state.done, true);
  assert.equal(status.state.complete, false);
  assert.match(status.state.error, /interrupted/);
  assert.equal(harness.store.x_likes_sync.running, false);
});
