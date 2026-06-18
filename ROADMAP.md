# ROADMAP

## Current Stage

- Stabilize the local feed browsing and search experience.

## Completed

- 2026-06-18: Fixed long expanded feed rows being removed by virtual scrolling before their action buttons could be reached. The active row now feeds its measured DOM height back into the virtual list layout.
- 2026-06-18: Prepared v0.4.6 release metadata for the long expanded row virtualization fix.

## In Progress

- None.

## Todo / Blocked

- None.

## Recent Verification

- 2026-06-18: `npm run test:unit`
- 2026-06-18: `npx playwright test tests/visual/feed.spec.js -g "keeps a long expanded row"`
