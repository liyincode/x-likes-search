# ROADMAP

## Current Stage

- Prepare v0.5.0 for final unpacked-extension validation after the native ESM migration.

## Completed

- 2026-08-19: Updated the tag-triggered release archive for the native ESM layout by replacing the deleted `feed-core.js` entry with the required `background/`, `core/`, and `feed/` source directories.
- 2026-08-19: Migrated the service worker, extension page, shared logic, tests, fixtures, and Playwright configs to native ESM without adding a build step; preserved classic `content.js` / `inject.js` boundaries and static-only service-worker imports.
- 2026-08-19: Split shared logic into responsibility-owned `core/` modules and the feed into state, posts, photos, and sync controllers. Removed the UMD `feed-core.js` and its duplicated 208-line declaration file after direct consumers and tests moved to the new modules.
- 2026-08-19: Replaced `file://` visual fixtures with an automatically managed Node static server and expanded strict JSDoc `checkJs` coverage to every runtime module with `@types/chrome`, while keeping zero emitted artifacts.
- 2026-08-18: Reconciled unliked records at X's observed Likes terminal shape: a real full sync ended with `TimelineAddEntries`, an unchanged Bottom cursor, and zero raw, parsed, or new tweet entries. The worker now re-requests that cursor once and treats two stable empty fixed points as the tail; content-bearing repeats and all other incomplete runs still preserve local data.
- 2026-08-18: Prevented captured pagination state from changing sync origin: the worker now strips a template cursor from base variables, starts at the Likes head, preserves all other variables, and uses only cursors returned during the current run. Added non-sensitive timeline-shape diagnostics for terminal-response investigation.
- 2026-08-18: Made long-running sync observable and bounded: the feed now shows page/checked/addition progress, each page request times out after 30 seconds with finite retries, and Stop aborts the active request immediately.
- 2026-08-18: Unified Sync around one user-facing contract: every run now traverses the current Likes timeline to its true tail, adds new likes, removes unliked records, and reports completion only after safe reconciliation. Removed incremental/full terminology and restored lightbox focus before hiding it.
- 2026-08-18: Added safe unlike reconciliation: the worker removes unseen local records only after a recognized Likes response reaches a true no-cursor tail, reports `removed`, and preserves all data on partial, repeated-cursor, stopped, failed, or unrecognized crawls.
- 2026-08-18: Removed the X-page Sync pill and page-world replay fallback, leaving the extension page as the only sync control while preserving passive Likes request capture. Removed the now-unused `activeTab` and `scripting` permissions.
- 2026-08-18: Added strict TypeScript `checkJs` coverage for `feed-core.js` with explicit core-domain and minimal GraphQL access-shape declarations, while preserving direct source loading and zero emitted build artifacts.
- 2026-08-18: Added a Posts / Photos view switch, responsive photo gallery, 60-item batch rendering, image-failure placeholders, and a full-result lightbox with keyboard navigation and source-post links.
- 2026-08-18: Added photo-only parsing from `legacy.extended_entities.media`, source attribution for wrapped retweet media, and a sanitized real multi-photo Likes GraphQL fixture covering the observed field structure.
- 2026-08-18: Added index schema version 2 and a one-time full media backfill that preserves existing `capturedAt` values and advances the schema version only after reaching the natural timeline tail.
- 2026-08-18: Updated the Finder design reference, Posts and Photos visual snapshots, user documentation, architecture notes, and v0.5.0 metadata.
- 2026-08-17: Hardened both sync paths so critical index/state/status storage failures stop the crawl and surface an explicit error instead of reporting completion.
- 2026-08-17: Added worker-memory sync-state reconciliation, fallback page-state forwarding, stale-running recovery, and coalesced feed index refreshes using `StorageChange.newValue`.
- 2026-08-17: Added the `unlimitedStorage` permission and prepared v0.4.7 metadata.
- 2026-06-18: Fixed long expanded feed rows being removed by virtual scrolling before their action buttons could be reached. The active row now feeds its measured DOM height back into the virtual list layout.
- 2026-06-18: Prepared v0.4.6 release metadata for the long expanded row virtualization fix.

## In Progress

- Reload the unpacked extension in Chrome, confirm the module service worker has no startup errors, refresh the feed, and run one real Sync to verify that a cancelled like is removed after the twice-confirmed empty repeated-cursor tail. Automated browser control cannot access `chrome://extensions` or `chrome-extension://` pages, so this remains a manual check.

## Todo / Blocked

- Replace the single-key `x_likes_index` design with sharded storage or IndexedDB if measured heavy-user profiles show material full-index serialization, write amplification, or `StorageChange.oldValue`/`newValue` delivery cost.

## Recent Verification

- 2026-08-19: Reproduced the release workflow's zip command locally; the 388 KB archive passed integrity checks and contained all runtime modules, manifest-referenced icons, and CSS-referenced fonts with no stale `feed-core.js` entry.
- 2026-08-19: `npm test` — strict JSDoc checking across all runtime modules, 34 unit tests, and 14 HTTP-served Playwright tests passed after the ESM/module split; visual snapshots remained unchanged.
- 2026-08-19: `npm run test:perf` and `npm run test:perf:input` passed after the final type pass; virtual rendering was 32.3× faster than the full-render baseline and input-to-painted-rows median was 230.0 ms in this run.
- 2026-08-18: `npm test` — TypeScript strict checking, 33 unit tests, and 14 Playwright tests passed after adding the twice-confirmed empty repeated-cursor tail; coverage verifies stable-tail deletion, content-bearing confirmation preservation, and continued pagination when confirmation advances.
- 2026-08-18: `npm run test:perf` — feed render benchmark passed after terminal reconciliation; virtual rendering was 30.0× faster than the full-render baseline in this run.
- 2026-08-18: `npm test` — TypeScript strict checking, 30 unit tests, and 14 Playwright tests passed after cleaning captured cursors and adding response-shape diagnostics; coverage verifies the first request omits a captured cursor, the second uses the current run's cursor, non-cursor variables survive, and raw/unparsed tweet entries remain distinguishable.
- 2026-08-18: `npm run test:perf` — feed render benchmark passed after cursor-origin hardening; virtual rendering was 31.6× faster than the full-render baseline in this run.
- 2026-08-18: `npm test` — TypeScript strict checking, 28 unit tests, and 14 Playwright tests passed after adding bounded sync requests and visible progress; coverage includes stalled-request timeout, finite retry failure, active-request Stop abort, and status-bar progress.
- 2026-08-18: `npm run test:perf` — feed render benchmark passed after sync observability changes; virtual rendering was 31.5× faster than the full-render baseline in this run.
- 2026-08-18: `npm test` — TypeScript strict checking, 26 unit tests, and 14 Playwright tests passed after unifying Sync semantics; coverage includes traversal beyond three known-only pages, tail reconciliation, repeated-cursor incompleteness, and lightbox focus restoration.
- 2026-08-18: `npm run test:perf` — feed render benchmark passed after unifying Sync semantics; virtual rendering was 33.2× faster than the full-render baseline in this run.
- 2026-08-18: `npm test` — TypeScript strict checking, 25 unit tests, and 14 Playwright tests passed after safe unlike reconciliation; coverage includes recognized empty-tail deletion, repeated-cursor preservation, malformed-response preservation, and schema-version tail gating.
- 2026-08-18: `npm run test:perf` — feed render benchmark passed after unlike reconciliation; virtual rendering was 34.1× faster than the full-render baseline in this run.
- 2026-08-18: `npm test` — TypeScript strict checking, 22 unit tests, and 14 Playwright tests passed after removing the page sync path; coverage includes passive template capture with no injected UI, the first-run History Likes link, missing-template redirect, and legacy page-state reconciliation.
- 2026-08-18: `npm run test:perf` — feed render benchmark passed after sync-entry consolidation; virtual rendering was 31.2× faster than the full-render baseline in this run.
- 2026-08-18: `npm test` — TypeScript strict checking, 22 unit tests, and 13 Playwright tests passed after adding core type coverage.
- 2026-08-18: `npm run test:perf` — feed render benchmark passed after type coverage; virtual rendering was 31.8× faster than the full-render baseline in this run.
- 2026-08-18: `npm test` — 22 unit tests and 13 Playwright tests passed, including the real-structure photo fixture, full-backfill completion rules, gallery interactions, failure/empty states, 60-item batching, updated visual snapshots, and Finder reference diffs.
- 2026-08-18: `npm run test:perf` — feed render benchmark passed; 1,376-like virtual rendering remained 30.6× faster than the full-render baseline in this run.
- 2026-08-17: `npm test` — 16 unit tests and 9 Playwright tests passed, including simulated quota failures in both sync paths.
- 2026-08-17: `npm run test:perf` — feed render benchmark passed.
- 2026-06-18: `npm run test:unit`
- 2026-06-18: `npx playwright test tests/visual/feed.spec.js -g "keeps a long expanded row"`
