const { test, expect } = require("@playwright/test");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");

test("content script captures the Likes request without injecting sync UI", async ({ page }) => {
  await page.route("https://x.com/i/history/likes", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><head></head><body><main>Likes</main></body></html>",
    })
  );
  await page.route("https://x.com/i/api/graphql/hash/Likes**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: {} }) })
  );
  await page.addInitScript(() => {
    window.__savedTemplates = [];
    window.__pageResults = [];
    window.chrome = {
      runtime: {
        id: "test-extension",
        getURL() { return "data:text/javascript,"; },
      },
      storage: {
        local: {
          async set(items) {
            if (items.x_likes_template) window.__savedTemplates.push(items.x_likes_template);
          },
        },
      },
    };
    window.addEventListener("message", (event) => {
      if (event.data?.type === "PAGE_RESULT") window.__pageResults.push(event.data);
    });
  });

  await page.goto("https://x.com/i/history/likes");
  await page.addScriptTag({ path: path.join(root, "content.js") });
  await page.addScriptTag({ path: path.join(root, "inject.js") });
  await page.evaluate(async () => {
    await fetch("https://x.com/i/api/graphql/hash/Likes?variables=%7B%7D", {
      headers: { "x-csrf-token": "test-token" },
    });
  });

  await expect.poll(() => page.evaluate(() => window.__savedTemplates.length)).toBe(1);
  const template = await page.evaluate(() => window.__savedTemplates[0]);
  expect(template.url).toContain("/graphql/hash/Likes");
  expect(template.headers["x-csrf-token"]).toBe("test-token");
  expect(template.method).toBe("GET");
  await expect(page.locator("#xls-fab")).toHaveCount(0);

  await page.evaluate(() => {
    window.postMessage({
      source: "xls-cmd",
      type: "FETCH_PAGE",
      id: 1,
      url: "https://x.com/i/api/graphql/hash/Likes",
    }, "*");
  });
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => window.__pageResults)).toEqual([]);
});
