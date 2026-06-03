# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Manifest V3 Chrome extension that indexes your X (Twitter) likes locally and lets you browse/search them in an X-styled feed. It works by **capturing** the GraphQL request X's own page makes to load your Likes timeline, then **replaying** that request with successive pagination cursors. Nothing leaves the browser; there is no server.

## Dev workflow (no build step; tests are optional tooling)

The extension itself is plain static JS/HTML/CSS loaded unpacked — **there is no build step or bundler**, and nothing is compiled before loading. There IS now a `package.json`, but it only carries dev-only test tooling (Playwright, pixelmatch, pngjs) and `npm` scripts; the extension never imports node_modules and ships the source files as-is.

- **Load:** `chrome://extensions` → enable Developer mode → **Load unpacked** → select this folder.
- **After editing `content.js`, `inject.js`, `background.js`, or `manifest.json`:** click **Reload** on the extension card, then **reload the open `x.com` tab** (content/inject scripts only re-run on a fresh page load).
- **After editing `feed.html` / `feed.css` / `feed.js` / `feed-core.js`:** just refresh the feed tab — these are read fresh on load, no extension reload needed.
- **Manual test loop:** open `https://x.com/<username>/likes`, refresh once, use the on-page **Sync** button (a pill anchored under the **Likes** tab) — or click **sync likes** in the Finder tab — then open the feed via the toolbar icon. See `README.md` for the full user-facing flow.

### Tests

- `npm run test:unit` — `node:test` over `feed-core.js` logic (no browser, no install of browsers needed).
- `npm run test:visual` — Playwright: mocks `chrome.*`, exercises interactions, and pixel-diffs the implementation against `design/x-likes-search/Likes Finder.html`. Requires `npm install` (+ Playwright's chromium).
- `npm test` — both. Snapshots live in `tests/visual/feed.spec.js-snapshots/`; the `design/` folder is the visual reference and is required by the visual suite.
- **Put testable logic in `feed-core.js`, not `feed.js`** — `feed-core.js` is DOM-free precisely so it can be unit-tested under Node. `feed.js` should stay a thin DOM/`chrome.*` binding layer.

## Architecture: three execution worlds

The hard part of this codebase is that code runs in three isolated JavaScript contexts that cannot call each other directly — they communicate only by message passing. Understanding this split is essential before changing anything.

1. **Page world — `inject.js`** (injected by `content.js` via a `<script>` tag, runs at `document_start`). This is the only context with the page's real `fetch`, cookies, and auth state. It:
   - Patches `window.fetch` and `XMLHttpRequest` to detect X's Likes GraphQL call (`LIKES_URL_RE`) and capture its URL + headers.
   - Acts as a **fetch bridge**: on a `FETCH_PAGE` message it performs the replayed request (with `credentials: "include"`) and posts back `PAGE_RESULT`. Replays must happen here so cookies/auth match what X expects.

2. **Content-script world — `content.js`** (runs at `document_start` on x.com/twitter.com; `feed-core.js` is loaded just before it in the same world). Isolated JS context but has `chrome.storage`. Its main job now is **capture**: inject `inject.js`, own the page↔storage bridge, and persist the captured request template. It still renders an on-page **Sync** control — a pill anchored under the profile's **Likes** tab (positioned inside the "your likes are private" banner via `getBoundingClientRect`, never injected into X's React tree) — and can run a page-world `syncLikes` from it (legacy/fallback path), but the **primary sync no longer lives here** — see below.

3. **Service worker — `background.js`** (`importScripts("feed-core.js")`). This is where the **primary sync runs**. Given a stored template it replays the Likes GraphQL endpoint with `fetch(url, { credentials: "include", headers })` directly: the extension's `host_permissions` make the browser attach the user's x.com cookies, and the captured `x-csrf-token`/bearer headers authenticate the call. No x.com tab is involved, so it survives redirects/navigation. It owns pagination, retry/backoff, and writes progress to `x_likes_sync`.

4. **Extension page — `feed.html` + `feed.js` + `feed-core.js`** (opened as a tab by `background.js` on toolbar click). Has `chrome.tabs`/`chrome.storage` but no access to x.com pages. `feed-core.js` is the DOM-free logic core (UMD; also `require`d by unit tests); `feed.js` is a thin DOM/`chrome.*` layer that renders the Finder UI and **drives a sync by messaging the service worker** (no tab juggling).

### Message protocols

Two separate channels — keep the string constants in sync across files:

**`window.postMessage`** — `content.js` ⇄ `inject.js` (page world ↔ content script), tagged-envelope:
- `source: "xls"` — page → content: `TEMPLATE_CAPTURED` (captured request), `PAGE_RESULT` (replay response, correlated by `id`).
- `source: "xls-cmd"` — content → page: `FETCH_PAGE` (replay this URL with these headers).

**`chrome.runtime.sendMessage`** — `feed.js` → `background.js` (Finder tab → service worker), `source: "xls-feed"`:
- `START_SYNC` (optional `mode: "full" | "incremental"`) — starts the SW sync and **acks immediately** `{ ok, started }` (or `{ ok, alreadyRunning }`, or `{ ok:false, error }` when no template is captured). It does **not** wait for the multi-minute crawl. `STOP_SYNC` sets a stop flag. `SYNC_STATUS` returns `{ ok, running, state }`. `runtime.sendMessage` reaches the SW and extension pages only — not content scripts — so there is no conflict with `content.js`.

### Storage schema (`chrome.storage.local`)

Key-name constants are **duplicated** across files and must stay identical:
- `x_likes_index` — the main dataset: a map of `tweetId → { tweetId, text, datetime, author, displayName, avatar, url, capturedAt }`, plus optional `likes` / `reposts` counts when X provides them. `feed-core.js`'s `normalizeLike` maps these raw records into the Finder's view model (`{ author: {name, handle, hue, avatar}, date, stats, … }`) — keep that mapping in sync with what the parser writes.
- `x_likes_state` — `{ lastSyncAt, total, completed }`. `completed` records whether the last crawl reached a natural end; the SW reads it to auto-pick `full` mode and resume an interrupted crawl.
- `x_likes_template` — the captured `{ url, headers, method }` used for replay.
- `x_likes_sync` — **transient** sync progress written by the SW and watched by the feed: `{ running, done, complete, mode, page, added, total, message, error, stopped, startedAt }`.

The feed auto-refreshes via `chrome.storage.onChanged`, so a SW sync live-updates an open feed tab (both new tweets and the status line).

## Two fragile spots tied to X's internals

- **`parseLikesResponse` in `feed-core.js`** walks X's GraphQL timeline `instructions`/`entries` to extract tweets and the bottom cursor. **Single source of truth** — used by both `content.js` (on-page button path) and `background.js` (SW sync). It uses defensive optional-chaining fallbacks (e.g. `legacy` vs `core`, `note_tweet` vs `full_text`). Update here, nowhere else, when extraction breaks.
- **`LIKES_URL_RE` in `inject.js`** (`/graphql/<hash>/Likes`) matches the endpoint regardless of the rotating query hash, so capture survives X's hash churn. The sync loops mutate only the `cursor` field inside the URL's `variables` JSON param, preserving everything else X sent. (Note: the *stored template URL* still pins a specific hash; if X rotates it the replay can 404, which surfaces as a sync error telling the user to refresh their likes page to recapture.)

### Sync loop termination & robustness (`background.js`)

The SW `syncLoop` paginates until any of: no `nextCursor`, the cursor repeats, (incremental mode only) 3 consecutive pages add zero new tweets, an exhausted-retry/permanent fetch error, GraphQL errors-without-data, or the user hits Stop. Hardening:
- **Retry/backoff** (`fetchPage`): transient failures (network errors, HTTP 429, 5xx) retry with backoff (`RETRY_BACKOFF`, honoring `Retry-After`) so one blip doesn't abort a long crawl; permanent failures (401/403/404 — usually a stale template) fail fast with a "refresh your likes page" hint.
- **Modes**: `incremental` early-stops at the known top of the feed; `full` paginates to the true tail. Auto-picks `full` when the index is empty or the last run didn't complete (`!state.completed`), which self-heals an interrupted crawl. Clearing the cache forces the next sync to be `full`.
- It dedupes by `tweetId` and saves the index after every page, so progress survives SW termination and re-runs resume.
