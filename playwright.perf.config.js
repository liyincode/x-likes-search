const base = require("./playwright.config.js");

module.exports = {
  ...base,
  testDir: "./tests/perf",
  testMatch: "**/*.{spec,perf}.{js,ts}",
  timeout: 120000,
};
