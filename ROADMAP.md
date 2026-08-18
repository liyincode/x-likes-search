# ROADMAP

## Current Stage

- Prepare v0.5.0 liked-photo gallery for manual release validation.

## Completed

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

- v0.5.0 release validation: reload the unpacked extension, refresh the open X tab, complete one real full sync, and verify the Photos count and lightbox against live stored data.

## Todo / Blocked

- Replace the single-key `x_likes_index` design with sharded storage or IndexedDB if measured heavy-user profiles show material full-index serialization, write amplification, or `StorageChange.oldValue`/`newValue` delivery cost.
- Update the fallback on-page Sync pill for X's observed `/i/history/likes` route and its selected Likes-tab anchor. The primary feed-triggered worker sync is independent of this pill.

## Recent Verification

- 2026-08-18: `npm test` — 22 unit tests and 13 Playwright tests passed, including the real-structure photo fixture, full-backfill completion rules, gallery interactions, failure/empty states, 60-item batching, updated visual snapshots, and Finder reference diffs.
- 2026-08-18: `npm run test:perf` — feed render benchmark passed; 1,376-like virtual rendering remained 30.6× faster than the full-render baseline in this run.
- 2026-08-17: `npm test` — 16 unit tests and 9 Playwright tests passed, including simulated quota failures in both sync paths.
- 2026-08-17: `npm run test:perf` — feed render benchmark passed.
- 2026-06-18: `npm run test:unit`
- 2026-06-18: `npx playwright test tests/visual/feed.spec.js -g "keeps a long expanded row"`
