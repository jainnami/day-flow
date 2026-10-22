import { expect, test } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { Dashboard } from "../../src/components/dashboard";
import type { Task, User } from "../../src/lib/types";
// Visual fixture only. Functional interactions are tested in dashboard.test.tsx.
const user: User = { id: "visual-user", email: "student@example.com", timezone: "America/New_York", workStart: "09:00", workEnd: "18:00", sleepStart: "23:00", sleepEnd: "07:00", selectedCalendarIds: ["primary"], rightNowCalendarId: "calendar", rightNowTaskListId: "list" };
const base: Task = { id: "task-one", userId: user.id, requestId: "request-one", title: "Finish the finance problem set", durationMinutes: 60, dueAt: "2026-11-01T23:00:00Z", deadlineLocal: "2026-11-01T18:00", status: "scheduled", rationale: "Timing updated from Google Calendar.", createdAt: "2026-10-22T12:00:00Z", startAt: "2026-10-23T18:00:00Z", endAt: "2026-10-23T19:00:00Z", calendarId: "calendar", eventId: "event-one", googleTaskListId: "list", googleTaskId: "google-one", googleLinkState: "linked", sessionStatus: "moved_externally" };
test("linked completion dashboard layout fits the viewport", async ({ page }, testInfo) => {
  const tasks: Task[] = [base,
    { ...base, id: "task-two", title: "Prepare research notes", status: "completed", sessionStatus: "canceled", rationale: "Completed in Google Tasks. Future work session canceled." },
    { ...base, id: "task-three", title: "Review the project requirements with my teammate", dueAt: null, deadlineLocal: null, status: "needs_review", sessionStatus: "removed_externally", rationale: "The work session was removed. The Google Task remains open." },
  ];
  const markup = renderToStaticMarkup(createElement(Dashboard, { initialUser: user, initialTasks: tasks, ready: true, tasksConnected: true, autoSync: false, initialMessage: "Synced Google Tasks completion and Calendar event changes." }));
  const css = readFileSync("src/app/globals.css", "utf8");
  await page.setContent(`<html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>${markup}</body></html>`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Finish the finance problem set" })).toBeVisible();
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  await expect(page.getByText("No deadline", { exact: true })).toBeVisible();
  await expect(page.getByLabel(/Finish by \(optional\)/)).not.toHaveAttribute("required", "");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("dashboard.png"), fullPage: true });
});
