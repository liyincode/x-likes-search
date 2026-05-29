# X Likes Search (Chrome Extension)

Browse and search your X (Twitter) liked tweets in an X-styled feed — locally, instantly, offline.

**v0.3 — Feed view.** Click the extension icon and a full-page tab opens that looks like X's likes timeline (avatars, handles, dates, full text). Click any tweet card to open the original; press `Enter` in the search box to open and step to the next match.

## How it works

1. **`inject.js`** patches `window.fetch` from `document_start` on `x.com`. When X's own JS loads your likes feed, the URL + auth headers are captured.
2. **`content.js`** stores that template and, on demand, replays the request with successive `cursor` values to paginate through your likes (~20 per page). Each tweet's id / author / display name / avatar / full text / timestamp goes into `chrome.storage.local`.
3. **`feed.html`** is the X-styled search/browse UI. Plain substring match (text + author + display name), instant.

No server, no manual auth, nothing leaves your browser.

## Install (unpacked)

1. Chrome → `chrome://extensions`
2. Toggle **Developer mode**.
3. **Load unpacked** → pick this folder.
4. Pin the extension icon.

## Usage

### One-time: capture & sync

1. Open `https://x.com/<your-username>/likes`. **Refresh once** so `inject.js` patches `fetch` before X's first request.
2. The bottom-right floating panel shows `Request captured ✓` once it sees a real Likes call.
3. Click **Sync** in that panel. The status line shows `Page N: +M (run +X, total Y)`.

### Browse & search

- Click the extension icon → opens (or focuses) the **Likes feed** tab.
- Type in the search box — results filter instantly, first match auto-selected.
- **`Enter` / `↓`** next match · **`Shift+Enter` / `↑`** previous match (Cmd+F-style — Enter does **not** open the tweet, just navigates through matches).
- **`Cmd+Enter` (macOS) / `Ctrl+Enter`** opens the selected tweet in a background tab. **Click** a card opens too.
- **`Esc`** clear search · **`/`** focus search bar.
- Click any tweet card to open the original on x.com.
- **Open X likes** / **Export** / **Clear** buttons in the header for the obvious operations.

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
content.js        # Inject bridge + sync orchestrator + sync panel on /likes pages
inject.js         # Page-world fetch/XHR patch + capture + replay bridge
feed.html/css/js  # Full-page X-styled likes browser & search
```
