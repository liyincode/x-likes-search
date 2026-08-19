// Tuned to match .row / .row.active in feed.css.
export const ROW_COLLAPSED = 56;
export const ROW_ACTIVE_EXPANDED = 128;

/** @typedef {{ tops: number[], heights: number[], totalHeight: number }} RowLayout */
/** @typedef {{ start: number, end: number, totalHeight: number }} VisibleRange */

/**
 * @param {number} count
 * @param {number} activeIndex
 * @param {number} [collapsed]
 * @param {number} [expanded]
 * @returns {RowLayout}
 */
export function buildRowOffsets(count, activeIndex, collapsed = ROW_COLLAPSED, expanded = ROW_ACTIVE_EXPANDED) {
  const tops = new Array(count);
  const heights = new Array(count);
  let y = 0;
  for (let i = 0; i < count; i += 1) {
    tops[i] = y;
    const height = activeIndex >= 0 && i === activeIndex ? expanded : collapsed;
    heights[i] = height;
    y += height;
  }
  return { tops, heights, totalHeight: y };
}

/**
 * @param {number} scrollTop
 * @param {number} viewportHeight
 * @param {RowLayout} layout
 * @param {number} [overscan]
 * @returns {VisibleRange}
 */
export function visibleRange(scrollTop, viewportHeight, layout, overscan = 5) {
  const { tops, heights, totalHeight } = layout;
  const count = tops.length;
  if (!count) return { start: 0, end: -1, totalHeight: 0 };

  let start = 0;
  let low = 0;
  let high = count - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (tops[middle] + heights[middle] > scrollTop) {
      start = middle;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  start = Math.max(0, start - overscan);

  const bottom = scrollTop + viewportHeight;
  let end = 0;
  low = 0;
  high = count - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (tops[middle] < bottom) {
      end = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  end = Math.min(count - 1, end + overscan);

  return { start, end, totalHeight };
}
