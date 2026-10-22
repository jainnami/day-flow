import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e", fullyParallel: false, workers: 1,
  reporter: "list", use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium", channel: "chrome" } },
  ],
  webServer: {
    command: "npm run start -- --port 3100", url: "http://localhost:3100", reuseExistingServer: false, timeout: 60000,
    env: { APP_URL: "http://localhost:3100", DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused", GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "test-secret", TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64") },
  },
});
