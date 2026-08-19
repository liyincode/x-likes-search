const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const Core = require("../../feed-core.js");

const source = fs.readFileSync(path.resolve(__dirname, "../../background/sync.js"), "utf8");
const runtimeSource = fs.readFileSync(path.resolve(__dirname, "../../background/runtime.js"), "utf8");

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

function pageBody(tweetId, nextCursor) {
  const body = responseBody();
  const entries = body.data.user.result.timeline_v2.timeline.instructions[0].entries;
  entries[0].content.itemContent.tweet_results.result.rest_id = tweetId;
  if (nextCursor) {
    entries.push({
      content: { entryType: "TimelineTimelineCursor", cursorType: "Bottom", value: nextCursor },
    });
  }
  return body;
}

function emptyCursorBody(cursor) {
  const body = responseBody();
  body.data.user.result.timeline_v2.timeline.instructions[0].entries = [{
    content: { entryType: "TimelineTimelineCursor", cursorType: "Bottom", value: cursor },
  }];
  return body;
}

function createHarness(initialStore, setImpl, fetchBody = responseBody()) {
  const store = structuredClone(initialStore);
  const writes = [];
  const fetchCalls = [];
  const debugLogs = [];
  const storage = {
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
  };
  const fetchImpl = async (url, init) => {
    fetchCalls.push({ url, init });
    const body = typeof fetchBody === "function"
      ? await fetchBody({ url, init, call: fetchCalls.length })
      : fetchBody;
    return {
      ok: true,
      status: 200,
      headers: { get() { return null; } },
      async text() { return JSON.stringify(body); },
    };
  };
  const logger = {
    debug(...args) { debugLogs.push(args); },
    error: console.error.bind(console),
    warn: console.warn.bind(console),
  };
  const context = {
    URL,
    AbortController,
    console: logger,
    setTimeout(fn, ms, ...args) { return setTimeout(fn, Math.min(ms, 5), ...args); },
    clearTimeout,
  };
  vm.runInNewContext(source, context, { filename: "background/sync.js" });
  const engine = context.XLSSync.createSyncEngine({
    storage,
    fetchImpl,
    core: Core,
    logger,
    setTimeoutImpl: context.setTimeout,
    clearTimeoutImpl: clearTimeout,
  });

  async function send(message) {
    if (message.source !== "xls-feed") return undefined;
    if (message.type === "START_SYNC") return engine.startSync();
    if (message.type === "STOP_SYNC") {
      engine.stopSync();
      return { ok: true };
    }
    if (message.type === "SYNC_STATUS") return engine.getStatus();
    return undefined;
  }

  return { store, writes, fetchCalls, debugLogs, send };
}

test("runtime adapter maps feed messages to the sync engine", async () => {
  let listener;
  const calls = [];
  const runtime = { onMessage: { addListener(fn) { listener = fn; } } };
  const engine = {
    async startSync() { calls.push("start"); return { ok: true, started: true }; },
    stopSync() { calls.push("stop"); },
    async getStatus() { calls.push("status"); return { ok: true, running: false }; },
  };
  const context = {};
  vm.runInNewContext(runtimeSource, context, { filename: "background/runtime.js" });
  context.XLSRuntime.registerRuntimeMessages(runtime, engine);

  const send = (message) => new Promise((resolve) => {
    const isAsync = listener(message, {}, resolve);
    if (!isAsync) queueMicrotask(() => resolve(undefined));
  });

  assert.deepEqual(await send({ source: "xls-feed", type: "START_SYNC" }), { ok: true, started: true });
  assert.deepEqual(await send({ source: "xls-feed", type: "SYNC_STATUS" }), { ok: true, running: false });
  assert.equal(await send({ source: "other", type: "START_SYNC" }), undefined);
  listener({ source: "xls-feed", type: "STOP_SYNC" }, {}, (response) => calls.push(response.ok));
  assert.deepEqual(calls, ["start", "status", "stop", true]);
});

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

test("worker times out a stalled page instead of staying in syncing state", async () => {
  const templateUrl = new URL("https://x.com/i/api/graphql/hash/Likes");
  templateUrl.searchParams.set("variables", "{}");
  const harness = createHarness({
    x_likes_template: { url: templateUrl.toString(), headers: {}, method: "GET" },
    x_likes_index: {},
    x_likes_state: { completed: false },
  }, null, ({ init }) => new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    });
  }));

  await harness.send({ source: "xls-feed", type: "START_SYNC" });
  let status;
  for (let i = 0; i < 100; i += 1) {
    status = await harness.send({ source: "xls-feed", type: "SYNC_STATUS" });
    if (status?.state?.done) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(status.running, false);
  assert.equal(status.state.complete, false);
  assert.match(status.state.error, /timed out/);
  assert.equal(harness.fetchCalls.length, 5);
});

test("worker stop aborts the active page request", async () => {
  const templateUrl = new URL("https://x.com/i/api/graphql/hash/Likes");
  templateUrl.searchParams.set("variables", "{}");
  let requestAborted = false;
  const harness = createHarness({
    x_likes_template: { url: templateUrl.toString(), headers: {}, method: "GET" },
    x_likes_index: {},
    x_likes_state: { completed: false },
  }, null, ({ init }) => new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => {
      requestAborted = true;
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    });
  }));

  await harness.send({ source: "xls-feed", type: "START_SYNC" });
  for (let i = 0; i < 20 && harness.fetchCalls.length === 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  await harness.send({ source: "xls-feed", type: "STOP_SYNC" });

  let status;
  for (let i = 0; i < 20; i += 1) {
    status = await harness.send({ source: "xls-feed", type: "SYNC_STATUS" });
    if (status?.state?.done) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(requestAborted, true);
  assert.equal(status.running, false);
  assert.equal(status.state.stopped, true);
  assert.equal(status.state.complete, false);
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

  await harness.send({ source: "xls-feed", type: "START_SYNC" });
  let status;
  for (let i = 0; i < 20; i += 1) {
    status = await harness.send({ source: "xls-feed", type: "SYNC_STATUS" });
    if (status?.state?.done) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(status.state.mode, undefined);
  assert.equal(status.state.mediaUpdated, 1);
  assert.equal(harness.store.x_likes_index["1"].capturedAt, 123);
  assert.equal(harness.store.x_likes_index["1"].media.length, 1);
  assert.equal(harness.store.x_likes_state.completed, true);
  assert.equal(harness.store.x_likes_state.indexVersion, Core.INDEX_VERSION);
});

test("worker reconciles a stale persisted running state after restart", async () => {
  const harness = createHarness({
    x_likes_sync: { running: true, source: "page", message: "Page 3" },
  });

  const status = await harness.send({ source: "xls-feed", type: "SYNC_STATUS" });

  assert.equal(status.running, false);
  assert.equal(status.state.done, true);
  assert.equal(status.state.complete, false);
  assert.match(status.state.error, /interrupted/);
  assert.equal(harness.store.x_likes_sync.running, false);
});

test("worker removes unseen likes after reaching a recognized timeline tail", async () => {
  const templateUrl = new URL("https://x.com/i/api/graphql/hash/Likes");
  templateUrl.searchParams.set("variables", "{}");
  const body = responseBody();
  body.data.user.result.timeline_v2.timeline.instructions[0].entries = [];
  const harness = createHarness({
    x_likes_template: { url: templateUrl.toString(), headers: {}, method: "GET" },
    x_likes_index: {
      "1": { tweetId: "1", text: "unliked", capturedAt: 123 },
    },
    x_likes_state: { completed: true, indexVersion: Core.INDEX_VERSION - 1 },
  }, null, body);

  await harness.send({ source: "xls-feed", type: "START_SYNC" });
  let status;
  for (let i = 0; i < 20; i += 1) {
    status = await harness.send({ source: "xls-feed", type: "SYNC_STATUS" });
    if (status?.state?.done) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(status.state.removed, 1);
  assert.equal(status.state.total, 0);
  assert.deepEqual(Object.keys(harness.store.x_likes_index), []);
  assert.match(status.state.message, /-1/);
  assert.equal(harness.store.x_likes_state.indexVersion, Core.INDEX_VERSION);
});

test("worker removes a captured cursor only from the first request", async () => {
  const templateUrl = new URL("https://x.com/i/api/graphql/hash/Likes");
  templateUrl.searchParams.set("variables", JSON.stringify({
    cursor: "STALE-TEMPLATE-CURSOR",
    count: 40,
    includePromotedContent: false,
  }));
  const pages = [pageBody("1", "CURSOR-A"), pageBody("2", null)];
  const harness = createHarness({
    x_likes_template: { url: templateUrl.toString(), headers: {}, method: "GET" },
    x_likes_index: {},
    x_likes_state: { completed: false, indexVersion: Core.INDEX_VERSION },
  }, null, ({ call }) => pages[call - 1]);

  await harness.send({ source: "xls-feed", type: "START_SYNC" });
  let status;
  for (let i = 0; i < 30; i += 1) {
    status = await harness.send({ source: "xls-feed", type: "SYNC_STATUS" });
    if (status?.state?.done) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(status.state.complete, true);
  assert.equal(harness.fetchCalls.length, 2);
  const firstVariables = JSON.parse(new URL(harness.fetchCalls[0].url).searchParams.get("variables"));
  const secondVariables = JSON.parse(new URL(harness.fetchCalls[1].url).searchParams.get("variables"));
  assert.deepEqual(firstVariables, { count: 40, includePromotedContent: false });
  assert.deepEqual(secondVariables, {
    count: 40,
    includePromotedContent: false,
    cursor: "CURSOR-A",
  });

  const firstDiagnostic = JSON.parse(JSON.stringify(
    harness.debugLogs.find((args) => args[0] === "Likes sync page")[1]
  ));
  assert.deepEqual(firstDiagnostic, {
    page: 1,
    templateHasCursor: true,
    requestCursorPresent: false,
    cursorAdvanced: true,
    instructionTypes: ["TimelineAddEntries"],
    rawTweetEntryCount: 1,
    parsedTweetCount: 1,
    unparsedTweetEntryCount: 0,
    newSeenCount: 1,
    terminateDirection: null,
  });
  assert.equal(JSON.stringify(harness.debugLogs).includes("STALE-TEMPLATE-CURSOR"), false);
  assert.equal(JSON.stringify(harness.debugLogs).includes("CURSOR-A"), false);
});

test("ordinary sync continues through known pages to reconcile the true tail", async () => {
  const templateUrl = new URL("https://x.com/i/api/graphql/hash/Likes");
  templateUrl.searchParams.set("variables", "{}");
  const pages = [
    pageBody("1", "CURSOR-A"),
    pageBody("2", "CURSOR-B"),
    pageBody("3", "CURSOR-C"),
    pageBody("4", null),
  ];
  const harness = createHarness({
    x_likes_template: { url: templateUrl.toString(), headers: {}, method: "GET" },
    x_likes_index: {
      "1": { tweetId: "1", text: "one", capturedAt: 1 },
      "2": { tweetId: "2", text: "two", capturedAt: 2 },
      "3": { tweetId: "3", text: "three", capturedAt: 3 },
      "4": { tweetId: "4", text: "four", capturedAt: 4 },
      stale: { tweetId: "stale", text: "unliked", capturedAt: 5 },
    },
    x_likes_state: { completed: true, indexVersion: Core.INDEX_VERSION },
  }, null, ({ call }) => pages[call - 1]);

  await harness.send({ source: "xls-feed", type: "START_SYNC" });
  let status;
  for (let i = 0; i < 40; i += 1) {
    status = await harness.send({ source: "xls-feed", type: "SYNC_STATUS" });
    if (status?.state?.done) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(harness.fetchCalls.length, 4);
  assert.equal(status.state.complete, true);
  assert.equal(status.state.checked, 4);
  assert.equal(status.state.removed, 1);
  assert.equal(harness.store.x_likes_index.stale, undefined);
});

test("worker confirms a stable empty cursor fixed point before removing unliked records", async () => {
  const templateUrl = new URL("https://x.com/i/api/graphql/hash/Likes");
  templateUrl.searchParams.set("variables", "{}");
  const pages = [pageBody("1", "CURSOR-A"), emptyCursorBody("CURSOR-A"), emptyCursorBody("CURSOR-A")];
  const harness = createHarness({
    x_likes_template: { url: templateUrl.toString(), headers: {}, method: "GET" },
    x_likes_index: {
      "1": { tweetId: "1", text: "seen", capturedAt: 1 },
      stale: { tweetId: "stale", text: "unliked", capturedAt: 2 },
    },
    x_likes_state: { completed: true, indexVersion: Core.INDEX_VERSION },
  }, null, ({ call }) => pages[call - 1]);

  await harness.send({ source: "xls-feed", type: "START_SYNC" });
  let status;
  for (let i = 0; i < 40; i += 1) {
    status = await harness.send({ source: "xls-feed", type: "SYNC_STATUS" });
    if (status?.state?.done) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(harness.fetchCalls.length, 3);
  assert.equal(status.state.complete, true);
  assert.equal(status.state.removed, 1);
  assert.equal(harness.store.x_likes_index.stale, undefined);
});

test("worker preserves local likes when fixed-point confirmation returns new content", async () => {
  const templateUrl = new URL("https://x.com/i/api/graphql/hash/Likes");
  templateUrl.searchParams.set("variables", "{}");
  const pages = [pageBody("1", "CURSOR-A"), emptyCursorBody("CURSOR-A"), pageBody("2", "CURSOR-A")];
  const harness = createHarness({
    x_likes_template: { url: templateUrl.toString(), headers: {}, method: "GET" },
    x_likes_index: {
      "1": { tweetId: "1", text: "seen", capturedAt: 1 },
      stale: { tweetId: "stale", text: "keep on anomaly", capturedAt: 2 },
    },
    x_likes_state: { completed: true, indexVersion: Core.INDEX_VERSION },
  }, null, ({ call }) => pages[call - 1]);

  await harness.send({ source: "xls-feed", type: "START_SYNC" });
  let status;
  for (let i = 0; i < 40; i += 1) {
    status = await harness.send({ source: "xls-feed", type: "SYNC_STATUS" });
    if (status?.state?.done) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(harness.fetchCalls.length, 3);
  assert.equal(status.state.complete, false);
  assert.equal(status.state.removed, 0);
  assert.ok(harness.store.x_likes_index.stale);
  assert.ok(harness.store.x_likes_index["2"]);
  assert.doesNotMatch(status.state.error, /pagination cursor/);
});

test("worker continues when fixed-point confirmation advances the cursor", async () => {
  const templateUrl = new URL("https://x.com/i/api/graphql/hash/Likes");
  templateUrl.searchParams.set("variables", "{}");
  const pages = [
    pageBody("1", "CURSOR-A"),
    emptyCursorBody("CURSOR-A"),
    pageBody("2", "CURSOR-B"),
    pageBody("3", null),
  ];
  const harness = createHarness({
    x_likes_template: { url: templateUrl.toString(), headers: {}, method: "GET" },
    x_likes_index: {
      "1": { tweetId: "1", text: "one", capturedAt: 1 },
      "2": { tweetId: "2", text: "two", capturedAt: 2 },
      "3": { tweetId: "3", text: "three", capturedAt: 3 },
      stale: { tweetId: "stale", text: "unliked", capturedAt: 4 },
    },
    x_likes_state: { completed: true, indexVersion: Core.INDEX_VERSION },
  }, null, ({ call }) => pages[call - 1]);

  await harness.send({ source: "xls-feed", type: "START_SYNC" });
  let status;
  for (let i = 0; i < 50; i += 1) {
    status = await harness.send({ source: "xls-feed", type: "SYNC_STATUS" });
    if (status?.state?.done) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(harness.fetchCalls.length, 4);
  assert.equal(status.state.complete, true);
  assert.equal(status.state.removed, 1);
  assert.equal(harness.store.x_likes_index.stale, undefined);
});

test("worker never removes likes when pagination repeats before the tail", async () => {
  const templateUrl = new URL("https://x.com/i/api/graphql/hash/Likes");
  templateUrl.searchParams.set("variables", "{}");
  const body = responseBody();
  body.data.user.result.timeline_v2.timeline.instructions[0].entries.push({
    content: { entryType: "TimelineTimelineCursor", cursorType: "Bottom", value: "CURSOR-A" },
  });
  const harness = createHarness({
    x_likes_template: { url: templateUrl.toString(), headers: {}, method: "GET" },
    x_likes_index: {
      "1": { tweetId: "1", text: "seen", capturedAt: 123 },
      "2": { tweetId: "2", text: "not reached", capturedAt: 124 },
    },
    x_likes_state: { completed: true, indexVersion: Core.INDEX_VERSION - 1 },
  }, null, body);

  await harness.send({ source: "xls-feed", type: "START_SYNC" });
  let status;
  for (let i = 0; i < 40; i += 1) {
    status = await harness.send({ source: "xls-feed", type: "SYNC_STATUS" });
    if (status?.state?.done) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(status.state.removed, 0);
  assert.equal(status.state.complete, false);
  assert.ok(harness.store.x_likes_index["2"]);
  assert.equal(harness.store.x_likes_state.indexVersion, Core.INDEX_VERSION - 1);
});

test("worker preserves local likes when X returns an unrecognized response shape", async () => {
  const templateUrl = new URL("https://x.com/i/api/graphql/hash/Likes");
  templateUrl.searchParams.set("variables", "{}");
  const harness = createHarness({
    x_likes_template: { url: templateUrl.toString(), headers: {}, method: "GET" },
    x_likes_index: {
      "1": { tweetId: "1", text: "keep me", capturedAt: 123 },
    },
    x_likes_state: { completed: true, indexVersion: Core.INDEX_VERSION },
  }, null, { data: {} });

  await harness.send({ source: "xls-feed", type: "START_SYNC" });
  let status;
  for (let i = 0; i < 20; i += 1) {
    status = await harness.send({ source: "xls-feed", type: "SYNC_STATUS" });
    if (status?.state?.done) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.match(status.state.error, /Could not find the Likes timeline/);
  assert.equal(status.state.removed, 0);
  assert.ok(harness.store.x_likes_index["1"]);
});
