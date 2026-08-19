import base from "./playwright.config.js";

export default {
  ...base,
  testDir: "./tests/perf",
  testMatch: "**/*.{spec,perf}.{js,ts}",
  timeout: 120000,
};
