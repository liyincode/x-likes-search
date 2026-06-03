const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests/visual",
  timeout: 30000,
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
