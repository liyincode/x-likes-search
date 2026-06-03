# X Likes Search (Chrome Extension)

Browse and search your X (Twitter) liked tweets in an X-styled feed — locally, instantly, offline.

**v0.4 — Finder.** Click the extension icon and a full-page "Likes · Finder" tab opens: a command-style search bar over your liked tweets with instant keyword highlighting, author/media filters, newest/oldest/author sorting, recent-search history, a dark/light theme toggle, and full keyboard navigation. You can kick off a sync straight from this page — no need to visit `/likes` manually.

## How it works

1. **`inject.js`** patches `window.fetch` from `document_start` on `x.com`. When X's own JS loads your likes feed, the URL + auth headers are captured into `chrome.storage`.
2. **`background.js`** (service worker) does the actual sync: given the captured template it replays the Likes GraphQL request with `fetch(..., { credentials: "include" })`, so the browser attaches your x.com cookies and the captured `x-csrf-token`/bearer headers authenticate it — **no x.com tab needed**. It paginates with successive `cursor` values, with retry/backoff for transient errors and full/incremental modes for completeness, writing each tweet's id / author / display name / avatar / full text / timestamp / like & repost counts into `chrome.storage.local`.
3. **`content.js`** handles capture (injects `inject.js`, persists the template) and renders the on-page **Sync** button — a small pill anchored under the profile's **Likes** tab — which runs a page-world sync as a fallback path.
4. **`feed-core.js`** is a dependency-free, DOM-free core (UMD): the GraphQL `parseLikesResponse` (shared by the SW and content script) plus normalizing likes into view models, search matching/highlighting, sorting, filtering, author lists, relative dates, and history. It runs in the browser (`window.FeedCore`), the service worker (`importScripts`), and under Node (unit tests).
5. **`feed.html` + `feed.js`** is the Finder UI — a thin DOM/`chrome.*` layer over `feed-core.js` that messages the service worker to drive syncs. Plain substring match (text + author + display name), instant.

No server, no manual auth, nothing leaves your browser.

## Install (unpacked)

1. Chrome → `chrome://extensions`
2. Toggle **Developer mode**.
3. **Load unpacked** → pick this folder.
4. Pin the extension icon.

## Usage

### One-time: capture & sync

**One-time setup — let the extension capture X's request:** open `https://x.com/<your-username>/likes` once and **refresh** so `inject.js` patches `fetch` before X's first request. That alone captures the auth template — capture is silent, you don't have to click anything. (On the likes page a small **Sync** button also appears under the **Likes** tab.) After this, you never need the likes page again unless the capture goes stale.

**Then sync from anywhere:**

- **From the Finder tab (normal):** open the extension and click **sync likes ↻** (header or first-run dialog). The background service worker replays the captured request with your cookies — **no x.com tab required, nothing to keep open.** The status line shows live progress (`Page N: +M (run +X)`); the button becomes **stop sync ⏹**. New tweets stream into the list as they're fetched.
- **From the X likes page (fallback):** a small **Sync** button sits under the **Likes** tab (inside the "your likes are private" banner) if you prefer to run it there. While it runs, the button shows a live count and ends on `Synced N`.

If a sync ever errors with an auth/HTTP 403 message, the captured template went stale — just reload your likes page once to recapture, then sync again.

### Browse & search

- Click the extension icon → opens (or focuses) the **Likes · Finder** tab.
- Type in the search box — results filter instantly with match highlighting, first match auto-selected.
- **`Enter` / `↓`** next match · **`↑`** previous match (Cmd+F-style — Enter does **not** open the tweet, just navigates through matches).
- **`Cmd+Enter` (macOS) / `Ctrl+Enter`** opens the selected tweet in a background tab. **Double-click** a card opens too; a single click expands it to show stats and copy/open actions.
- **`Esc`** clear search · **`/`** focus search bar.
- **Filters & sort:** toggle `media only`, pick an author, and sort by newest / oldest / author.
- **Theme:** dark/light toggle in the header (remembered across sessions).
- **History:** recent searches appear under the empty search box; click to re-run, ✕ to remove.
- **export** (JSON download) / **clear cache** (in the first-run dialog) for data management.

### Re-sync later

Re-running Sync is **incremental** — already-indexed tweets are skipped. The feed view auto-refreshes when sync writes new data.

## Caveats

- **Completeness:** X paginates likes server-side; very old likes may stop being returned after enough pages even with valid cursors. Run sync again on different days; new pagination windows sometimes open.
- **Rate limits:** if X errors mid-sync, wait a few minutes and resume — progress is saved every page.
- **API changes:** auth-capture is robust to header/hash changes (we replay what your browser already sent), but if X reshapes the GraphQL response, `parseLikesResponse` in `feed-core.js` needs a small update.

## Files

```
manifest.json     # MV3 manifest
background.js     # Action click → open/focus feed.html tab
content.js        # Inject bridge + capture + page-world sync + on-page Sync button (under the Likes tab)
inject.js         # Page-world fetch/XHR patch + capture + replay bridge
feed.html/css/js  # Full-page Finder UI (DOM + chrome.* layer)
feed-core.js      # DOM-free, dependency-free core logic (UMD; shared by the UI and unit tests)
assets/fonts/     # Bundled Space Grotesk + JetBrains Mono (no CDN, CSP-safe)
design/           # Static design reference the visual tests diff against
tests/            # Unit tests (node:test) + Playwright visual/interaction tests
```

## Development & tests

There's no build step — the extension is loaded unpacked as-is. Tests are optional tooling:

```
npm install            # dev deps only (Playwright, pixelmatch, pngjs)
npm run test:unit      # feed-core.js logic — pure Node, no browser
npm run test:visual    # Playwright: interactions + pixel diff vs design/
npm test               # both
```

`feed-core.js` holds all the testable logic so it can run under Node without a DOM. The visual suite mocks the `chrome.*` APIs and pixel-compares the implementation against `design/x-likes-search/Likes Finder.html`.

## License

[MIT](LICENSE) © Young
