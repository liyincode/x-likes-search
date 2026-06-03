# X Likes Search (Chrome Extension)

Browse and search your X (Twitter) liked tweets in an X-styled feed — locally, instantly, offline.

**v0.3 — Finder.** Click the extension icon and a full-page "Likes · Finder" tab opens: a command-style search bar over your liked tweets with instant keyword highlighting, author/media filters, newest/oldest/author sorting, recent-search history, a dark/light theme toggle, and full keyboard navigation. You can kick off a sync straight from this page — no need to visit `/likes` manually.

## How it works

1. **`inject.js`** patches `window.fetch` from `document_start` on `x.com`. When X's own JS loads your likes feed, the URL + auth headers are captured.
2. **`content.js`** stores that template and, on demand, replays the request with successive `cursor` values to paginate through your likes (~20 per page). Each tweet's id / author / display name / avatar / full text / timestamp / like & repost counts goes into `chrome.storage.local`. It also listens for `START_SYNC`/`STOP_SYNC` messages so the Finder tab can drive a sync remotely.
3. **`feed-core.js`** is a dependency-free, DOM-free core (UMD): normalizing stored likes into view models, search matching/highlighting, sorting, filtering, author lists, relative dates, and history management. It runs both in the browser (`window.FeedCore`) and under Node (for unit tests).
4. **`feed.html` + `feed.js`** is the Finder UI — a thin DOM/`chrome.*` layer over `feed-core.js`. Plain substring match (text + author + display name), instant.

No server, no manual auth, nothing leaves your browser.

## Install (unpacked)

1. Chrome → `chrome://extensions`
2. Toggle **Developer mode**.
3. **Load unpacked** → pick this folder.
4. Pin the extension icon.

## Usage

### One-time: capture & sync

You can start a sync two ways:

- **From the Finder tab (easiest):** open the extension and click **sync likes ↻** (in the header or the first-run dialog). It finds or opens your X likes tab in the background and runs the sync there. Leave that tab open while it paginates.
- **From the X likes page:** open `https://x.com/<your-username>/likes` and **refresh once** so `inject.js` patches `fetch` before X's first request. The bottom-right floating panel shows `Request captured ✓` once it sees a real Likes call; click **Sync** there. The status line shows `Page N: +M (run +X, total Y)`.

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
- **API changes:** auth-capture is robust to header/hash changes (we replay what your browser already sent), but if X reshapes the GraphQL response, `parseLikesResponse` in `content.js` needs a small update.

## Files

```
manifest.json     # MV3 manifest
background.js     # Action click → open/focus feed.html tab
content.js        # Inject bridge + sync orchestrator + sync panel + feed-driven sync messages
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
