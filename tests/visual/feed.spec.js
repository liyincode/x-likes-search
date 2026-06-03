const { test, expect } = require("@playwright/test");
const path = require("node:path");
const { PNG } = require("pngjs");
const fixture = require("../fixtures/likes.js");

const root = path.resolve(__dirname, "../..");
const feedUrl = `file://${path.join(root, "feed.html")}`;
const designUrl = `file://${path.join(root, "design/x-likes-search/Likes Finder.html")}`;

async function installChromeMock(page, index = fixture.index) {
  await page.addInitScript(({ indexData, stateData }) => {
    window.__XLS_NOW = "2026-06-03T12:00:00Z";
    window.__tabsCreated = [];
    window.__tabsQueried = [];
    window.__messagesSent = [];
    window.__runtimeMessages = [];
    window.__removedKeys = [];
    window.__storageListeners = [];
    window.__downloads = [];
    window.confirm = () => true;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value) => { window.__copied = value; } },
    });
    const localStore = {
      x_likes_index: indexData,
      x_likes_state: stateData,
    };
    window.__localStore = localStore;
    window.chrome = {
      runtime: {
        lastError: undefined,
        sendMessage(msg, cb) {
          window.__runtimeMessages.push(msg);
          const res = window.__workerResponse || { ok: true, started: true };
          if (cb) cb(res);
        },
      },
      storage: {
        local: {
          async get(keys) {
            const out = {};
            (Array.isArray(keys) ? keys : [keys]).forEach((key) => { out[key] = localStore[key]; });
            return out;
          },
          async remove(keys) {
            (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
              delete localStore[key];
              window.__removedKeys.push(key);
            });
          },
        },
        onChanged: {
          addListener(fn) { window.__storageListeners.push(fn); },
        },
      },
      tabs: {
        query(args, cb) {
          window.__tabsQueried.push(args);
          cb(window.__queryTabs || []);
        },
        create(args, cb) {
          const tab = { id: 42, url: args.url, active: args.active };
          window.__tabsCreated.push(args);
          if (cb) cb(tab);
          return Promise.resolve(tab);
        },
        sendMessage(tabId, msg, cb) {
          window.__messagesSent.push({ tabId, msg });
          if (cb) cb({ ok: true, total: 4, added: 0 });
        },
      },
    };
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) window.__downloads.push({ download: this.download, href: this.href });
      return originalClick.call(this);
    };
  }, { indexData: index, stateData: fixture.state });
}

async function openFeed(page, index) {
  await installChromeMock(page, index);
  await page.goto(feedUrl);
  await page.waitForSelector(".row");
}

function fontFaceCSS() {
  const fontDir = `file://${path.join(root, "assets/fonts").replaceAll("\\", "/")}`;
  return `
    @font-face { font-family: "Space Grotesk"; src: url("${fontDir}/SpaceGrotesk-400.ttf") format("truetype"); font-weight: 400; }
    @font-face { font-family: "Space Grotesk"; src: url("${fontDir}/SpaceGrotesk-500.ttf") format("truetype"); font-weight: 500; }
    @font-face { font-family: "Space Grotesk"; src: url("${fontDir}/SpaceGrotesk-600.ttf") format("truetype"); font-weight: 600; }
    @font-face { font-family: "Space Grotesk"; src: url("${fontDir}/SpaceGrotesk-700.ttf") format("truetype"); font-weight: 700; }
    @font-face { font-family: "JetBrains Mono"; src: url("${fontDir}/JetBrainsMono-400.ttf") format("truetype"); font-weight: 400; }
    @font-face { font-family: "JetBrains Mono"; src: url("${fontDir}/JetBrainsMono-500.ttf") format("truetype"); font-weight: 500; }
    @font-face { font-family: "JetBrains Mono"; src: url("${fontDir}/JetBrainsMono-600.ttf") format("truetype"); font-weight: 600; }
  `;
}

async function diffScreenshots(a, b) {
  const { default: pixelmatch } = await import("pixelmatch");
  const imgA = PNG.sync.read(a);
  const imgB = PNG.sync.read(b);
  if (imgA.width !== imgB.width || imgA.height !== imgB.height) return 1;
  const diff = new PNG({ width: imgA.width, height: imgA.height });
  const pixels = pixelmatch(imgA.data, imgB.data, diff.data, imgA.width, imgA.height, { threshold: 0.2 });
  return pixels / (imgA.width * imgA.height);
}

async function designStorageIndex(page) {
  await page.goto(designUrl);
  await page.addStyleTag({ content: fontFaceCSS() });
  await page.waitForSelector(".row");
  return page.evaluate(() => {
    const out = {};
    window.LIKED.forEach((t) => {
      out[t.id] = {
        tweetId: t.id,
        text: t.text,
        datetime: t.date,
        author: t.author.handle,
        displayName: t.author.name,
        avatar: "",
        url: t.url,
        capturedAt: 0,
      };
    });
    return out;
  });
}

test("renders Finder shell with storage data", async ({ page }) => {
  await openFeed(page);
  await expect(page.locator(".logo")).toContainText("X LikesSearch");
  await expect(page.locator("#sb-status")).toHaveText("4 liked · local only");
  await expect(page.locator(".row")).toHaveCount(4);
  await expect(page.locator("#mc")).toBeHidden();
  await expect(page.locator(".row.active")).toHaveCount(0);
  await expect(page.locator(".row").first().locator(".stats")).toHaveText("♡ 193⇄ 76");
  await expect(page.locator(".row").first().locator(".mtag")).toHaveCount(0);
  await expect(page.locator(".row").first().locator(".av img")).toHaveAttribute("src", /data:image\/svg\+xml/);
});

test("searches, navigates, opens, clears, and copies", async ({ page, browserName }) => {
  await openFeed(page);
  await page.locator("#q").fill("Claude");
  await page.waitForTimeout(250);
  await expect(page.locator(".row")).toHaveCount(2);
  await expect(page.locator("#mc")).toContainText("1 / 2 in 4");
  await expect(page.locator("mark").first()).toHaveText("Claude");

  await page.keyboard.press("ArrowDown");
  await expect(page.locator(".row.active")).toHaveAttribute("data-id", "1002");
  await page.locator(".row.active").click();
  await expect(page.locator(".row.active")).toHaveCount(0);
  await page.locator('[data-id="1002"]').click();
  await expect(page.locator(".row.active")).toHaveAttribute("data-id", "1002");
  await expect(page.locator(".row.active .stats")).toHaveText("♡ 70");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
  expect(await page.evaluate(() => window.__tabsCreated.at(-1))).toEqual({ url: "https://x.com/elenacodes/status/1002", active: false });

  await page.locator(".row.active .copy-btn").click();
  await expect(page.locator("#toast")).toHaveClass(/show/);
  expect(await page.evaluate(() => window.__copied)).toBe("https://x.com/elenacodes/status/1002");

  await page.keyboard.press("Escape");
  await expect(page.locator("#q")).toHaveValue("");
  await expect(page.locator(".row")).toHaveCount(4);

  await page.evaluate(() => document.getElementById("onboard").classList.add("show"));
  await expect(page.locator("#onboard")).toHaveClass(/show/);
  await page.locator("#clear").click();
  expect(await page.evaluate(() => window.__removedKeys)).toEqual(["x_likes_index", "x_likes_state"]);
  await expect(page.locator(".empty .big")).toHaveText("No likes indexed yet");
  expect(browserName).toBe("chromium");
});

test("theme, history, filters, sorting, export, and storage refresh work", async ({ page }) => {
  await openFeed(page);
  await page.locator("#theme-btn").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.locator("#theme-btn").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.locator("#q").fill("design");
  await page.waitForTimeout(250);
  await page.waitForTimeout(1200);
  await page.locator("#q").fill("");
  await page.locator("#q").focus();
  await expect(page.locator("#history")).toHaveClass(/show/);
  await expect(page.locator(".h-item")).toContainText(["design"]);
  await page.keyboard.press("Escape");
  await expect(page.locator("#history")).not.toHaveClass(/show/);

  await page.locator('[data-sort="author"]').click();
  await expect(page.locator(".row").first().locator(".nm")).toContainText("Devon");
  await page.locator('[data-sort="oldest"]').click();
  await expect(page.locator(".row").first()).toHaveAttribute("data-id", "1004");
  await page.locator("#export").click();
  expect(await page.evaluate(() => window.__downloads[0].download)).toMatch(/^x-likes-\d{4}-\d{2}-\d{2}\.json$/);

  await page.evaluate(() => {
    window.__localStore.x_likes_index["1005"] = {
      tweetId: "1005",
      text: "A new local-only liked tweet",
      datetime: "2026-06-03T08:00:00Z",
      author: "newdev",
      displayName: "New Dev",
      url: "https://x.com/newdev/status/1005",
    };
    window.__storageListeners.forEach((fn) => fn({ x_likes_index: {} }, "local"));
  });
  await expect(page.locator("#sb-status")).toHaveText("5 liked · local only");
});

test("starts and stops sync through the background worker", async ({ page }) => {
  await openFeed(page);

  // Click → START_SYNC goes to the worker (no x.com tab involved).
  await page.locator("#open-likes").click();
  await expect(page.locator("#toast")).toHaveClass(/show/);
  expect(await page.evaluate(() => window.__runtimeMessages.at(-1))).toEqual({
    source: "xls-feed",
    type: "START_SYNC",
  });

  // Worker reports progress via storage → status + button reflect it live.
  await page.evaluate(() => {
    window.__localStore.x_likes_sync = { running: true, message: "Page 2: +30 (run +30)", total: 34 };
    window.__storageListeners.forEach((fn) => fn({ x_likes_sync: { newValue: window.__localStore.x_likes_sync } }, "local"));
  });
  await expect(page.locator("#sb-status")).toContainText("Syncing…");
  await expect(page.locator("#open-likes")).toHaveText("stop sync ⏹");

  // Clicking while running sends STOP_SYNC.
  await page.locator("#open-likes").click();
  expect(await page.evaluate(() => window.__runtimeMessages.at(-1))).toEqual({
    source: "xls-feed",
    type: "STOP_SYNC",
  });

  // Worker reports done → button returns to idle.
  await page.evaluate(() => {
    window.__localStore.x_likes_sync = { running: false, done: true, message: "Done. +30 (total 34)." };
    window.__storageListeners.forEach((fn) => fn({ x_likes_sync: { newValue: window.__localStore.x_likes_sync } }, "local"));
  });
  await expect(page.locator("#open-likes")).toHaveText("sync likes ↻");

  // From a fresh worker (no captured template) START_SYNC surfaces an error.
  await page.evaluate(() => { window.__workerResponse = { ok: false, error: "No captured request yet." }; });
  await page.locator("#open-likes").click();
  await expect(page.locator("#toast-txt")).toHaveText("No captured request yet.");
});

test("visual states match the Finder direction with strict thresholds", async ({ page }) => {
  await openFeed(page);
  await expect(page).toHaveScreenshot("finder-dark.png", { maxDiffPixelRatio: 0.02 });
  await page.locator("#q").fill("Claude");
  await page.waitForTimeout(250);
  await expect(page).toHaveScreenshot("finder-search.png", { maxDiffPixelRatio: 0.02 });
  await page.locator("#theme-btn").click();
  await expect(page).toHaveScreenshot("finder-light.png", { maxDiffPixelRatio: 0.02 });
  await page.evaluate(() => document.getElementById("onboard").classList.add("show"));
  await expect(page).toHaveScreenshot("finder-onboard.png", { maxDiffPixelRatio: 0.02 });
});

test("implementation screenshots closely match the Finder reference", async ({ browser }) => {
  const design = await browser.newPage({ viewport: { width: 924, height: 540 }, deviceScaleFactor: 1 });
  const index = await designStorageIndex(design);
  await design.addStyleTag({ content: ".mtag,.stats{display:none!important}" });
  const designInitial = await design.screenshot({ fullPage: false });

  const impl = await browser.newPage({ viewport: { width: 924, height: 540 }, deviceScaleFactor: 1 });
  await openFeed(impl, index);
  await impl.addStyleTag({ content: ".mtag,.stats{display:none!important}" });
  const implInitial = await impl.screenshot({ fullPage: false });
  expect(await diffScreenshots(designInitial, implInitial)).toBeLessThan(0.08);

  await design.locator("#q").fill("Claude");
  await impl.locator("#q").fill("Claude");
  await impl.waitForTimeout(250);
  const designSearch = await design.screenshot({ fullPage: false });
  const implSearch = await impl.screenshot({ fullPage: false });
  expect(await diffScreenshots(designSearch, implSearch)).toBeLessThan(0.08);

  await design.close();
  await impl.close();
});
