import { expect, test } from "@playwright/test";
test("welcome page is readable and has no horizontal overflow", async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your next task. A time to start." })).toBeVisible();
  await expect(page.getByRole("link", { name: /Connect Google Calendar/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("welcome.png"), fullPage: true });
});
test("task API requires a signed-in session", async ({ request }) => {
  expect((await request.get("/api/tasks")).status()).toBe(401);
  const response = await request.post("/api/tasks", { headers: { origin: "http://localhost:3100" }, data: {} });
  expect(response.status()).toBe(401);
});
test("foreign mutation origin is rejected", async ({ request }) => {
  const response = await request.post("/api/settings", { headers: { origin: "https://attacker.example" }, data: {} });
  expect(response.status()).toBe(403);
});
test("OAuth initiation sets a private cookie and requests state and PKCE", async ({ request }) => {
  const response = await request.get("/api/auth/google", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  const url = new URL(response.headers().location);
  expect(url.hostname).toBe("accounts.google.com");
  expect(url.searchParams.get("state")!.length).toBeGreaterThan(30);
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  expect(url.searchParams.get("access_type")).toBe("offline");
  expect(url.searchParams.get("scope")).not.toContain("auth/tasks");
  expect(response.headers()["set-cookie"]).toContain("HttpOnly");
});
test("callback rejects mismatched state before exchanging a code", async ({ request }) => {
  await request.get("/api/auth/google", { maxRedirects: 0 });
  const response = await request.get("/api/auth/google/callback?state=wrong&code=invalid", { maxRedirects: 0 });
  expect(response.headers().location).toBe("http://localhost:3100/?auth=state");
});
test("denied OAuth permission shows a clear recoverable message", async ({ request, page }) => {
  const start = await request.get("/api/auth/google", { maxRedirects: 0 });
  const state = new URL(start.headers().location).searchParams.get("state");
  const response = await request.get(`/api/auth/google/callback?state=${state}&error=access_denied`, { maxRedirects: 0 });
  expect(response.headers().location).toBe("http://localhost:3100/?auth=denied");
  await page.goto("/?auth=denied");
  await expect(page.getByRole("status")).toContainText("permission was declined");
});
