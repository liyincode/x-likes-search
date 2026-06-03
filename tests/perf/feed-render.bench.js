/**
 * Node render benchmarks — legacy full render vs P0 filter vs P1 virtual window.
 * Run: npm run test:perf
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../../feed-core.js");

const COUNT = 1376;
const QUERY = "claude design";
const WARMUP = 3;
const RUNS = 50;
const VIRTUAL_VIEWPORT = 400;
const VIRTUAL_OVERSCAN = 5;

function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildLikes(n) {
  const rand = mulberry32(42);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const handle = `user${i % 220}`;
    out.push(
      Core.normalizeLike({
        tweetId: String(1_000_000 + i),
        text: `Tweet ${i}: Claude, design systems, and local search ${Math.floor(rand() * 1e6)}`,
        datetime: new Date(2020, 0, 1 + (i % 800)).toISOString(),
        author: handle,
        displayName: `Display ${handle}`,
        avatar: "",
        url: `https://x.com/${handle}/status/${1_000_000 + i}`,
        capturedAt: 1_780_000_000_000 + i,
        likes: Math.floor(rand() * 500),
        reposts: Math.floor(rand() * 120),
      })
    );
  }
  return out;
}

function benchRowHTML(t, i, q, activeIndex) {
  const active = i === activeIndex ? " active" : "";
  const c = Core.avatarColors(t.author.hue);
  const fallback = Core.initials(t.author.name);
  const stats = t.stats
    ? `<span class="stats">${Number.isFinite(t.stats.likes) ? `<span>♡ ${t.stats.likes}</span>` : ""}${Number.isFinite(t.stats.reposts) ? `<span>⇄ ${t.stats.reposts}</span>` : ""}</span>`
    : "";
  return `
    <div class="row${active}" data-i="${i}" data-id="${Core.escapeHTML(t.tweetId)}">
      <div class="av" style="background:linear-gradient(135deg, ${c.bg}, ${c.bg2})"><span class="av-fallback">${fallback}</span></div>
      <div class="meta">
        <div class="line1">
          <span class="nm">${Core.highlight(t.author.name, q)}</span>
          <span class="hd">@${Core.highlight(t.author.handle, q)}</span>
        </div>
        <div class="snip">${Core.highlight(t.text, q) || '<span style="opacity:.55">(no text)</span>'}</div>
        <div class="expand"><div class="row-actions">${stats}</div></div>
      </div>
      <div class="when">${Core.relativeDate(t.date, new Date("2026-06-03T12:00:00Z"))}</div>
    </div>`;
}

function simulateLegacyRender(all, sort, q) {
  const base = Core.pipeline(all, sort);
  const view = base.filter((t) => Core.matches(t, q));
  const parts = [];
  for (let i = 0; i < view.length; i += 1) parts.push(benchRowHTML(view[i], i, q, -1));
  return parts.join("");
}

function simulateP0FilterOnly(base, q) {
  let n = 0;
  for (let i = 0; i < base.length; i += 1) {
    if (Core.matches(base[i], q)) n += 1;
  }
  return n;
}

function simulateP1VirtualRender(base, q) {
  const view = base.filter((t) => Core.matches(t, q));
  const layout = Core.buildRowOffsets(view.length, -1);
  const { start, end } = Core.visibleRange(0, VIRTUAL_VIEWPORT, layout, VIRTUAL_OVERSCAN);
  const parts = [];
  for (let i = start; i <= end; i += 1) parts.push(benchRowHTML(view[i], i, q, -1));
  return parts.join("");
}

function timeRuns(fn) {
  const samples = [];
  for (let i = 0; i < WARMUP + RUNS; i += 1) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return samples.slice(WARMUP);
}

function median(nums) {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function p95(nums) {
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)];
}

function ratio(a, b) {
  if (!b) return "—";
  return `${(a / b).toFixed(1)}×`;
}

test(`feed render bench (${COUNT} likes)`, () => {
  const all = buildLikes(COUNT);
  const sort = "newest";
  const base = Core.pipeline(all, sort);

  const legacy = timeRuns(() => simulateLegacyRender(all, sort, QUERY));
  const p0 = timeRuns(() => simulateP0FilterOnly(base, QUERY));
  const p1 = timeRuns(() => simulateP1VirtualRender(base, QUERY));

  const legacyMed = median(legacy);
  const p0Med = median(p0);
  const p1Med = median(p1);
  const speedup = legacyMed / p1Med;

  console.log(`\n=== feed-render bench (n=${COUNT}, query=${JSON.stringify(QUERY)}) ===\n`);
  console.log("| scenario | median ms | p95 ms | vs legacy |");
  console.log("|----------|-----------|--------|-----------|");
  console.log(`| baseline-full-render | ${legacyMed.toFixed(2)} | ${p95(legacy).toFixed(2)} | 1.0× |`);
  console.log(`| p0-filter-only | ${p0Med.toFixed(3)} | ${p95(p0).toFixed(3)} | ${ratio(legacyMed, p0Med)} faster |`);
  console.log(
    `| p1-virtual-render (~25 rows) | ${p1Med.toFixed(2)} | ${p95(p1).toFixed(2)} | ${ratio(legacyMed, p1Med)} faster |`
  );
  console.log(
    `\nSummary: full HTML ${legacyMed.toFixed(2)} ms → virtual ${p1Med.toFixed(2)} ms (${ratio(legacyMed, p1Med)}, ${(((legacyMed - p1Med) / legacyMed) * 100).toFixed(0)}% reduction)\n`
  );

  assert.ok(speedup >= 5, `expected virtual speedup ≥5×, got ${speedup.toFixed(1)}×`);
});
