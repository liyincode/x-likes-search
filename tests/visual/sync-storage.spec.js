const { test, expect } = require("@playwright/test");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");

test("page sync exposes an index quota failure instead of reporting Done", async ({ page }) => {
  await page.route("https://x.com/tester/likes", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><body><nav><a role="tab" href="/tester/likes">Likes</a></nav></body></html>',
    })
  );
  await page.addInitScript(() => {
    const templateUrl = new URL("https://x.com/i/api/graphql/hash/Likes");
    templateUrl.searchParams.set("variables", "{}");
    const store = {
      x_likes_template: { url: templateUrl.toString(), headers: {} },
      x_likes_index: {},
      x_likes_state: { completed: false },
    };
    window.__pageSyncMessages = [];
    window.chrome = {
      runtime: {
        id: "test-extension",
        lastError: undefined,
        getURL() { return "data:text/javascript,"; },
        sendMessage(message, callback) {
          window.__pageSyncMessages.push(message);
          if (callback) callback({ ok: true });
        },
      },
      storage: {
        local: {
          async get(keys) {
            const out = {};
            for (const key of Array.isArray(keys) ? keys : [keys]) out[key] = store[key];
            return out;
          },
          async set(items) {
            if (Object.hasOwn(items, "x_likes_index")) {
              throw new Error("QUOTA_BYTES quota exceeded");
            }
            Object.assign(store, items);
          },
        },
        onChanged: { addListener() {} },
      },
    };
    window.addEventListener("message", (event) => {
      if (event.data?.source !== "xls-cmd" || event.data.type !== "FETCH_PAGE") return;
      window.postMessage({
        source: "xls",
        type: "PAGE_RESULT",
        id: event.data.id,
        ok: true,
        body: {
          data: {
            user: {
              result: {
                timeline_v2: {
                  timeline: {
                    instructions: [{
                      type: "TimelineAddEntries",
                      entries: [{
                        content: {
                          entryType: "TimelineTimelineItem",
                          itemContent: {
                            itemType: "TimelineTweet",
                            tweet_results: { result: {
                              rest_id: "1",
                              legacy: { full_text: "one", created_at: "Wed Jun 03 10:00:00 +0000 2026" },
                              core: { user_results: { result: { legacy: { screen_name: "alice", name: "Alice" } } } },
                            } },
                          },
                        },
                      }],
                    }],
                  },
                },
              },
            },
          },
        },
      }, "*");
    });
  });

  await page.goto("https://x.com/tester/likes");
  await page.addScriptTag({ path: path.join(root, "feed-core.js") });
  await page.addScriptTag({ path: path.join(root, "content.js") });
  await page.locator("#xls-fab").click();

  await expect(page.locator("#xls-fab")).toHaveAttribute("data-state", "error");
  await expect(page.locator("#xls-fab .xls-fab-tip")).toContainText("Local storage is full");
  const finalState = await page.evaluate(() => window.__pageSyncMessages.at(-1));
  expect(finalState).toMatchObject({
    source: "xls-page",
    type: "SYNC_STATE",
    state: { running: false, done: true, complete: false },
  });
  expect(finalState.state.error).toContain("Local storage is full");
});
