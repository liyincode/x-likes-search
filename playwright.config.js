const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/visual",
  timeout: 30000,
  webServer: {
    command: "node tests/support/static-server.mjs",
    url: "http://127.0.0.1:4173/feed.html",
    reuseExistingServer: !process.env.CI,
  },
  expect: {
    timeout: 5000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      threshold: 0.2,
      animations: "disabled",
    },
  },
  use: {
    browserName: "chromium",
    viewport: { width: 924, height: 540 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
  },
});
