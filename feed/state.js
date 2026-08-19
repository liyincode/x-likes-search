import { normalizeLike } from "../core/likes.js";
import { matches, pipeline } from "../core/search.js";

/** @typedef {import("../core/likes.js").LikeIndex} LikeIndex */
/** @typedef {{ indexVersion?: number, [key: string]: unknown }} IndexState */
/** @typedef {{ running?: boolean, done?: boolean, error?: string, message?: string, [key: string]: unknown }} SyncState */

export const appState = {
  q: "",
  sort: /** @type {"newest" | "oldest" | "author"} */ ("newest"),
  mode: /** @type {"posts" | "photos"} */ ("posts"),
  active: -1,
  rawLikes: /** @type {import("../core/likes.js").LikeRecord[]} */ ([]),
  allLikes: /** @type {import("../core/likes.js").LikeView[]} */ ([]),
  view: /** @type {import("../core/likes.js").LikeView[]} */ ([]),
  indexState: /** @type {IndexState} */ ({}),
  syncState: /** @type {SyncState} */ ({}),
};

/** @type {import("../core/likes.js").LikeView[] | null} */
let cachedBase = null;
/** @type {"newest" | "oldest" | "author" | null} */
let cachedSort = null;

export function invalidatePipelineCache() {
  cachedSort = null;
  cachedBase = null;
}

export function getCachedBase() {
  if (cachedBase && cachedSort === appState.sort) return cachedBase;
  cachedSort = appState.sort;
  cachedBase = pipeline(appState.allLikes, appState.sort);
  return cachedBase;
}

export function rebuildView() {
  const base = getCachedBase();
  appState.view = appState.q ? base.filter((tweet) => matches(tweet, appState.q)) : base;
  if (appState.q && appState.active < 0 && appState.view.length) appState.active = 0;
  if (appState.active >= appState.view.length) {
    appState.active = appState.view.length ? 0 : -1;
  }
}

/** @param {LikeIndex} index */
export function applyIndexModel(index) {
  appState.rawLikes = Object.values(index);
  appState.allLikes = appState.rawLikes.map(normalizeLike);
  invalidatePipelineCache();
}
