# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Manifest V3 Chrome extension that indexes your X (Twitter) likes locally and lets you browse/search them in an X-styled feed. It works by **capturing** the GraphQL request X's own page makes to load your Likes timeline, then **replaying** that request with successive pagination cursors. Nothing leaves the browser; there is no server.

## Dev workflow (no build step; tests are optional tooling)

The extension itself is plain static JS/HTML/CSS loaded unpacked — **there is no build step or bundler**, and nothing is compiled before loading. `package.json` carries dev-only test and type tooling; the extension never imports node_modules and ships the source files as-is.

### Native ESM constraints

The service worker, extension page, shared core, and Node tests use native ESM without a build step:

- Preserve all storage schemas, message strings, sync behavior, DOM structure, visual snapshots, and performance contracts.
- Keep `content.js` and `inject.js` as classic scripts so capture still runs at `document_start` in the required execution worlds.
- Use only static imports in the module service worker; extension service workers do not support dynamic `import()`.
- Assign mutable state to an owning module. Only genuinely cross-module application state may live in a shared state object; caches, DOM references, layout state, gallery state, and timers remain module-private.
- Keep internal JSDoc types beside their implementations. Reserve `types/` for external or ambient contracts that have no local implementation.
- Continue loading the repository root unpacked. Do not introduce `dist/`, a bundler, a watch process, or generated runtime artifacts.

- **Load:** `chrome://extensions` → enable Developer mode → **Load unpacked** → select this folder.
- **After editing `content.js`, `inject.js`, `background.js`, `background/`, `core/`, or `manifest.json`:** click **Reload** on the extension card, then **reload the open `x.com` tab** (content/inject scripts only re-run on a fresh page load).
- **After editing `feed.html`, `feed.css`, `feed.js`, or `feed/`:** refresh the feed tab. Changes under `core/` also require an extension reload because the service worker imports them.
- **Manual test loop:** open `https://x.com/i/history/likes` and let it load once so the request template is captured, then open the feed via the toolbar icon and click the top-right **sync** button. The extension deliberately adds no controls to X's page.

### Tests

- `npm run typecheck` — strict TypeScript `checkJs` over every runtime JS module, with `@types/chrome`; `noEmit` keeps the extension build-free.
- `npm run test:unit` — `node:test` over DOM-free `core/` and `background/` logic (no browser or installed browser needed).
- `npm run test:perf` — Node bench comparing legacy full HTML render vs cached filter vs virtual window (~1376 synthetic likes). `npm run test:perf:input` — Playwright input-to-paint latency (optional).
- `npm run test:visual` — Playwright starts the repository's local static server, mocks `chrome.*`, exercises interactions, and pixel-diffs the implementation against `design/x-likes-search/Likes Finder.html`. Requires `npm install` (+ Playwright's chromium).
- `npm test` — typecheck, unit, and visual suites. Snapshots live in `tests/visual/feed.spec.js-snapshots/`; the `design/` folder is the visual reference and is required by the visual suite.
- Put reusable DOM-free logic in `core/`, background synchronization in `background/`, and page controllers in `feed/`. Keep internal JSDoc types beside implementations; `types/` contains only external X and ambient browser contracts.

## Architecture: four execution worlds

The hard part of this codebase is that code runs in four isolated JavaScript contexts that cannot call each other directly — they communicate only by message passing or shared extension storage. Understanding this split is essential before changing anything.

1. **Page world — `inject.js`** (injected by `content.js` via a `<script>` tag, runs at `document_start`). This is the only context with the page's real `fetch`, cookies, and auth state. It:
   - Patches `window.fetch` and `XMLHttpRequest` to detect X's Likes GraphQL call (`LIKES_URL_RE`) and capture its URL + headers.

2. **Content-script world — `content.js`** (runs at `document_start` on x.com/twitter.com). It injects `inject.js`, receives `TEMPLATE_CAPTURED`, and persists the request template through `chrome.storage`. It does not render UI or run a sync loop.

3. **Module service worker — `background.js`** (`manifest.json` declares `"type": "module"`). It statically imports `background/runtime.js`, `background/sync.js`, and DOM-free modules from `core/`. Given a stored template it replays the Likes GraphQL endpoint with `fetch(url, { credentials: "include", headers })`; no x.com tab is involved.

4. **Module extension page — `feed.html` + `feed.js` + `feed/` + `core/`** (opened by `background.js`). `feed.js` composes page behavior; `feed/state.js`, `feed/posts.js`, `feed/photos.js`, `feed/export.js`, and `feed/sync.js` own their state and responsibilities. It drives sync by messaging the service worker; CSV/JSON export and explicit single-photo or selected-photo downloads remain local user actions.

### Message protocols

Two separate channels — keep the string constants in sync across files:

**`window.postMessage`** — `inject.js` → `content.js` (page world → content script), tagged-envelope:
- `source: "xls"`, `type: "TEMPLATE_CAPTURED"` — the captured request template to persist.

**`chrome.runtime.sendMessage`** — `feed.js` → `background.js` (X Likes Search tab → service worker), `source: "xls-feed"`:
- `START_SYNC` — starts the SW sync and **acks immediately** `{ ok, started }` (or `{ ok, alreadyRunning }`, or `{ ok:false, error }` when no template is captured). It does **not** wait for the multi-minute crawl. `STOP_SYNC` sets a stop flag. `SYNC_STATUS` returns `{ ok, running, state }`. `runtime.sendMessage` reaches the SW and extension pages only — not content scripts — so there is no conflict with `content.js`.

### Storage schema (`chrome.storage.local`)

Module-world key constants live in `core/constants.js`. `content.js` and `inject.js` remain classic scripts in isolated worlds, so their documented protocol/storage strings are manual copies that must stay identical.

- `x_likes_index` — the main dataset: a map of `tweetId → { tweetId, text, datetime, author, displayName, avatar, url, capturedAt }`, plus optional `likes` / `reposts`, photo-only `media[]`, and `mediaSource` when media came from a wrapped source tweet. `core/likes.js` maps these records into the search view model; keep that mapping aligned with the parser.
- `x_likes_state` — `{ lastSyncAt, total, completed, indexVersion }`. `completed` records whether the last crawl reached a natural end; `indexVersion` advances only after a complete crawl has backfilled stored records.
- `x_likes_template` — the captured `{ url, headers, method }` used for replay.
- `x_likes_sync` — **transient** sync progress written by the SW and watched by the feed: `{ running, done, complete, page, checked, added, removed, total, message, error, stopped, startedAt }`. The worker also keeps the latest value in memory so a storage failure can still be reported through `SYNC_STATUS`.

The feed auto-refreshes via `chrome.storage.onChanged`, so a SW sync live-updates an open feed tab (both new tweets and the status line). Index updates consume `StorageChange.newValue` directly and are coalesced while a sync is running; sync-state changes do not reload the full index. Critical index/state/status writes must reject on failure rather than allowing the sync to report completion.

## Two fragile spots tied to X's internals

- **`parseLikesResponse` in `core/x-likes-parser.js`** walks X's GraphQL timeline `instructions`/`entries` to extract tweets, photo metadata, the bottom cursor, and non-sensitive response-shape diagnostics. Its external response types live in `types/x-api.d.ts`; update both when X changes the response.
- **`LIKES_URL_RE` in `inject.js`** (`/graphql/<hash>/Likes`) matches the endpoint regardless of the rotating query hash, so capture survives X's hash churn. The sync loops mutate only the `cursor` field inside the URL's `variables` JSON param, preserving everything else X sent. (Note: the *stored template URL* still pins a specific hash; if X rotates it the replay can 404, which surfaces as a sync error telling the user to refresh their likes page to recapture.)

### Sync loop termination & robustness (`background.js`)

The SW `syncLoop` paginates until any of: no `nextCursor`, a twice-confirmed empty repeated-cursor response, another cursor anomaly, an exhausted-retry/permanent fetch error, GraphQL errors-without-data, or the user hits Stop. A user-facing Sync always traverses toward the natural tail so its contract is to reconcile both newly liked and unliked posts. Hardening:
- **Timeout/retry/backoff** (`fetchPage`): each page request has a 30-second timeout and is aborted immediately when the user stops. Transient failures (timeouts, network errors, HTTP 429, 5xx) retry with backoff (`RETRY_BACKOFF`, honoring `Retry-After`) so one blip doesn't abort a long crawl; permanent failures (401/403/404 — usually a stale template) fail fast with a "refresh your likes page" hint.
- **Single sync contract**: every run starts at the current Likes head and continues to the true tail. `Done` is reported only after reaching that tail; implementation modes are not exposed to users.
- **Clean sync origin**: capture may persist a paginated Likes request, so `syncLoop` removes the captured `variables.cursor` from its base variables. Only cursors returned during the current run may be used after the first request.
- **Safe reconciliation**: collect every returned tweet ID, but remove unseen local records only when the response contains a recognized instructions array and pagination reaches either a no-cursor tail or the empty repeated-cursor terminal shape observed from X (`rawTweetEntryCount === 0`, no parsed/new tweets) twice at the same cursor. The second request is a defensive confirmation, not a protocol guarantee. Repeated cursors carrying content, failures, and user stops never delete records.
- It dedupes by `tweetId` and saves the index after every page, so progress survives SW termination and re-runs resume.
