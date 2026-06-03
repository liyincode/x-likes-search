/**
 * Playwright input-to-painted-rows latency (1376 mock likes).
 * Run: npm run test:perf:input
 */
const { test, expect } = require("@playwright/test");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");
const feedUrl = `file://${path.join(root, "feed.html")}`;
const COUNT = 1376;

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildIndex(n) {
  const rand = mulberry32(42);
  const index = {};
  for (let i = 0; i < n; i += 1) {
    const handle = `user${i % 220}`;
    const id = String(1_000_000 + i);
    index[id] = {
      tweetId: id,
      text: `Tweet ${i}: Claude, design systems, and local search ${Math.floor(rand() * 1e6)}`,
      datetime: new Date(2020, 0, 1 + (i % 800)).toISOString(),
      author: handle,
      displayName: `Display ${handle}`,
      avatar: "",
      url: `https://x.com/${handle}/status/${id}`,
      capturedAt: 1_780_000_000_000 + i,
      likes: Math.floor(rand() * 500),
      reposts: Math.floor(rand() * 120),
    };
  }
  return index;
}

const bigIndex = buildIndex(COUNT);

async function installChromeMock(page) {
  await page.addInitScript(({ indexData, stateData }) => {
    window.__XLS_NOW = "2026-06-03T12:00:00Z";
    const localStore = {
      x_likes_index: indexData,
      x_likes_state: stateData,
    };
    window.chrome = {
      runtime: { sendMessage(_msg, cb) { if (cb) cb({ ok: true }); } },
      storage: {
        local: {
          async get(keys) {
            const out = {};
            (Array.isArray(keys) ? keys : [keys]).forEach((k) => { out[k] = localStore[k]; });
            return out;
          },
        },
        onChanged: { addListener() {} },
      },
      tabs: { query(_a, cb) { cb([]); }, create(_a, cb) { if (cb) cb({ id: 1 }); } },
    };
  }, { indexData: bigIndex, stateData: { lastSyncAt: Date.now(), total: COUNT, completed: true } });
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

test("input-to-painted-rows latency", async ({ page }) => {
  test.setTimeout(120_000);
  await installChromeMock(page);
  await page.goto(feedUrl);
  await page.waitForSelector(".row");

  const samples = [];
  for (let run = 0; run < 5; run += 1) {
    const ms = await page.evaluate(async (runIndex) => {
      const q = document.getElementById("q");
      const start = performance.now();
      q.value = runIndex % 2 ? "claude" : "design";
      q.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 220));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const rows = document.querySelectorAll("#results .virtual-window .row").length;
      const vh = document.getElementById("feed-scroll").clientHeight;
      return { ms: performance.now() - start, rows, vh };
    }, run);
    samples.push(ms.ms);
    console.log(`run ${run + 1}: ${ms.ms.toFixed(1)} ms (${ms.rows} rows painted, results vh=${ms.vh})`);
    expect(ms.rows).toBeLessThan(40);
  }

  const med = median(samples);
  console.log(`\nPlaywright input→paint median: ${med.toFixed(1)} ms (5 runs, ${COUNT} indexed)\n`);
  expect(med).toBeLessThan(800);
});
