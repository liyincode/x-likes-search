const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../../feed-core.js");

test("buildRowOffsets uses expanded height only for active index", () => {
  const layout = Core.buildRowOffsets(4, 2);
  assert.equal(layout.tops[0], 0);
  assert.equal(layout.tops[1], Core.ROW_COLLAPSED);
  assert.equal(layout.tops[2], Core.ROW_COLLAPSED * 2);
  assert.equal(layout.heights[2], Core.ROW_ACTIVE_EXPANDED);
  assert.equal(
    layout.totalHeight,
    Core.ROW_COLLAPSED * 3 + Core.ROW_ACTIVE_EXPANDED
  );
});

test("visibleRange returns empty slice for zero count", () => {
  const layout = Core.buildRowOffsets(0, -1);
  const range = Core.visibleRange(0, 400, layout);
  assert.equal(range.start, 0);
  assert.equal(range.end, -1);
});

test("visibleRange covers active row near scroll center", () => {
  const count = 40;
  const layout = Core.buildRowOffsets(count, 20);
  const scrollTop = layout.tops[18];
  const range = Core.visibleRange(scrollTop, 300, layout, 2);
  assert.ok(range.start <= 20);
  assert.ok(range.end >= 20);
});

test("countMatches returns full length for empty query", () => {
  const list = [{ searchHay: "alpha" }, { searchHay: "beta" }];
  assert.equal(Core.countMatches(list, ""), 2);
  assert.equal(Core.countMatches(list, "beta"), 1);
});
