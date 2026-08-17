# ROADMAP

## Current Stage

- Stabilize the local feed browsing and search experience.

## Completed

- 2026-08-17: Hardened both sync paths so critical index/state/status storage failures stop the crawl and surface an explicit error instead of reporting completion.
- 2026-08-17: Added worker-memory sync-state reconciliation, fallback page-state forwarding, stale-running recovery, and coalesced feed index refreshes using `StorageChange.newValue`.
- 2026-08-17: Added the `unlimitedStorage` permission and prepared v0.4.7 metadata.
- 2026-06-18: Fixed long expanded feed rows being removed by virtual scrolling before their action buttons could be reached. The active row now feeds its measured DOM height back into the virtual list layout.
- 2026-06-18: Prepared v0.4.6 release metadata for the long expanded row virtualization fix.

## In Progress

- v0.5.0 liked-photo gallery: obtain a sanitized real Likes GraphQL fixture containing a multi-photo post before implementing media parsing.

## Todo / Blocked

- Replace the single-key `x_likes_index` design with sharded storage or IndexedDB if measured heavy-user profiles show material full-index serialization, write amplification, or `StorageChange.oldValue`/`newValue` delivery cost.

## Recent Verification

- 2026-08-17: `npm test` — 16 unit tests and 9 Playwright tests passed, including simulated quota failures in both sync paths.
- 2026-08-17: `npm run test:perf` — feed render benchmark passed.
- 2026-06-18: `npm run test:unit`
- 2026-06-18: `npx playwright test tests/visual/feed.spec.js -g "keeps a long expanded row"`
