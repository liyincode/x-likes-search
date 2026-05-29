# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this is

A Manifest V3 Chrome extension that indexes your X (Twitter) likes locally and lets you browse/search them in an X-styled feed. It works by **capturing** the GraphQL request X's own page makes to load your Likes timeline, then **replaying** that request with successive pagination cursors. Nothing leaves the browser; there is no server.

## Dev workflow (no build, no tests, no package manager)

This is plain static JS/HTML/CSS loaded as an unpacked extension. There is no build step, bundler, lint config, or test suite — do not look for `package.json` or npm scripts.

- **Load:** `chrome://extensions` → enable Developer mode → **Load unpacked** → select this folder.
- **After editing `content.js`, `inject.js`, `background.js`, or `manifest.json`:** click **Reload** on the extension card, then **reload the open `x.com` tab** (content/inject scripts only re-run on a fresh page load).
- **After editing `feed.html` / `feed.css` / `feed.js`:** just refresh the feed tab — these are read fresh on load, no extension reload needed.
- **Manual test loop:** open `https://x.com/<username>/likes`, refresh once, use the bottom-right sync panel, then open the feed via the toolbar icon. See `README.md` for the full user-facing flow.

## Architecture: three execution worlds

The hard part of this codebase is that code runs in three isolated JavaScript contexts that cannot call each other directly — they communicate only by message passing. Understanding this split is essential before changing anything.

1. **Page world — `inject.js`** (injected by `content.js` via a `<script>` tag, runs at `document_start`). This is the only context with the page's real `fetch`, cookies, and auth state. It:
   - Patches `window.fetch` and `XMLHttpRequest` to detect X's Likes GraphQL call (`LIKES_URL_RE`) and capture its URL + headers.
   - Acts as a **fetch bridge**: on a `FETCH_PAGE` message it performs the replayed request (with `credentials: "include"`) and posts back `PAGE_RESULT`. Replays must happen here so cookies/auth match what X expects.

2. **Content-script world — `content.js`** (runs at `document_start` on x.com/twitter.com). Isolated JS context but has `chrome.storage`. It injects `inject.js`, owns the page↔storage bridge, runs the pagination loop (`syncLikes`), and renders the bottom-right sync panel on `/likes` pages.

3. **Extension page — `feed.html` + `feed.js`** (opened as a tab by `background.js` on toolbar click). Has `chrome.tabs`/`chrome.storage` but no access to x.com pages. Pure read-and-render UI over stored data.

### Message protocol (`window.postMessage`)

`content.js` ⇄ `inject.js` use a tagged-envelope protocol. Keep these constants in sync across both files:
- `source: "xls"` — page world → content script: `TEMPLATE_CAPTURED` (captured request), `PAGE_RESULT` (replay response, correlated by `id`).
- `source: "xls-cmd"` — content script → page world: `FETCH_PAGE` (replay this URL with these headers).

### Storage schema (`chrome.storage.local`)

Three keys, written by `content.js` and read by `feed.js`. The key-name string constants are **duplicated** in both files and must stay identical:
- `x_likes_index` — the main dataset: a map of `tweetId → { tweetId, text, datetime, author, displayName, avatar, url, capturedAt }`.
- `x_likes_state` — `{ lastSyncAt, total }`.
- `x_likes_template` — the captured `{ url, headers, method }` used for replay.

The feed auto-refreshes via `chrome.storage.onChanged`, so a sync in the x.com tab live-updates an open feed tab.

## Two fragile spots tied to X's internals

- **`parseLikesResponse` in `content.js`** walks X's GraphQL timeline `instructions`/`entries` to extract tweets and the bottom cursor. This is the most likely thing to break when X reshapes its response; it uses defensive optional-chaining fallbacks (e.g. `legacy` vs `core`, `note_tweet` vs `full_text`) for exactly that reason. Update here, not elsewhere, when extraction breaks.
- **`LIKES_URL_RE` in `inject.js`** (`/graphql/<hash>/Likes`) matches the endpoint regardless of the rotating query hash, so it survives X's hash churn. The sync loop in `content.js` also mutates only the `cursor` field inside the URL's `variables` JSON param, preserving everything else X sent.

### Sync loop termination

`syncLikes` paginates until any of: no `nextCursor`, the cursor repeats, 3 consecutive pages add zero new tweets (assumed caught up), a fetch/GraphQL error, or the user hits Stop. It dedupes by `tweetId` and saves the index after every page, so progress survives interruptions and re-runs are incremental.
