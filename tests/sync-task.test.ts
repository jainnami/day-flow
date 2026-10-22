import { beforeEach, describe, expect, it, vi } from "vitest";
import { syncTask } from "../src/server/services/sync-task";
import { scheduleTask, type TaskRepository } from "../src/server/services/schedule-task";
import type { TasksPort } from "../src/server/tasks/adapter";
import type { CalendarPort, CalendarSyncPort } from "../src/server/calendar/adapter";
import type { Task, User } from "../src/lib/types";
let task: Task, repo: TaskRepository, google: TasksPort, calendar: CalendarSyncPort;
const now = "2026-10-22T12:00:00Z";
beforeEach(() => {
  task = { id: "local", userId: "user", requestId: "req", title: "Original finance title", durationMinutes: 60, deadlineLocal: "2026-11-01T18:00", dueAt: "2026-11-01T23:00:00Z", status: "scheduled", rationale: "Earliest slot", createdAt: now, startAt: "2026-10-23T14:00:00Z", endAt: "2026-10-23T15:00:00Z", calendarId: "calendar1", eventId: "event1", googleTaskId: "google1", googleTaskListId: "list1", googleLinkState: "linked", sessionStatus: "scheduled" };
  repo = { find: async () => task, insert: async () => {}, finish: vi.fn(async updated => { task = { ...updated }; }) };
  google = { getTask: vi.fn(async () => ({ id: "google1", status: "needsAction" as const })), findByMarker: vi.fn(async () => null), createTask: vi.fn(async () => ({ id: "unexpected" })), setDate: vi.fn(async () => {}) };
  calendar = { readEvent: vi.fn(async () => ({ id: "event1", start: { dateTime: task.startAt! }, end: { dateTime: task.endAt! } })), deleteEvent: vi.fn(async () => {}) };
});
describe("Google completion and Calendar reconciliation", () => {
  it("honors an event move without duplicating IDs or overwriting original title", async () => {
    vi.mocked(calendar.readEvent).mockResolvedValue({ id: "event1", start: { dateTime: "2026-10-23T18:00:00-04:00" }, end: { dateTime: "2026-10-23T19:00:00-04:00" } });
    const result = await syncTask(task, repo, google, calendar, now);
    expect(result).toMatchObject({ eventId: "event1", title: "Original finance title", startAt: "2026-10-23T22:00:00.000Z", sessionStatus: "moved_externally" }); expect(google.createTask).not.toHaveBeenCalled();
  });
  it("treats Calendar deletion as review needed while the Google Task remains open", async () => {
    vi.mocked(calendar.readEvent).mockResolvedValue(null);
    const result = await syncTask(task, repo, google, calendar, now);
    expect(result.status).toBe("needs_review"); expect(result.sessionStatus).toBe("removed_externally"); expect(result.googleTaskId).toBe("google1");
    expect(google.setDate).not.toHaveBeenCalled();
  });
  it("recognizes Calendar cancellation tombstones", async () => {
    vi.mocked(calendar.readEvent).mockResolvedValue({ id: "event1", status: "cancelled" });
    expect((await syncTask(task, repo, google, calendar, now)).sessionStatus).toBe("removed_externally");
  });
  it("marks a Google Task completed and cancels its future session", async () => {
    vi.mocked(google.getTask).mockResolvedValue({ id: "google1", status: "completed", completed: now });
    const result = await syncTask(task, repo, google, calendar, now);
    expect(result.status).toBe("completed"); expect(result.sessionStatus).toBe("canceled"); expect(calendar.deleteEvent).toHaveBeenCalledWith("calendar1", "event1");
    expect(google.setDate).not.toHaveBeenCalled();
  });
  it("also cancels a future session when the completed task has no deadline", async () => {
    task.dueAt = null; task.deadlineLocal = null;
    vi.mocked(google.getTask).mockResolvedValue({ id: "google1", status: "completed", completed: now });
    const result = await syncTask(task, repo, google, calendar, now);
    expect(result.status).toBe("completed"); expect(result.sessionStatus).toBe("canceled"); expect(result.dueAt).toBeNull(); expect(calendar.deleteEvent).toHaveBeenCalledWith("calendar1", "event1");
  });
  it("keeps elapsed sessions as history after completion", async () => {
    task.startAt = "2026-10-21T14:00:00Z"; task.endAt = "2026-10-21T15:00:00Z";
    vi.mocked(google.getTask).mockResolvedValue({ id: "google1", status: "completed" });
    expect((await syncTask(task, repo, google, calendar, now)).sessionStatus).toBe("elapsed"); expect(calendar.deleteEvent).not.toHaveBeenCalled();
  });
  it("preserves a session already in progress when completion arrives", async () => {
    task.startAt = "2026-10-22T11:30:00Z"; task.endAt = "2026-10-22T12:30:00Z";
    vi.mocked(google.getTask).mockResolvedValue({ id: "google1", status: "completed" });
    expect((await syncTask(task, repo, google, calendar, now)).status).toBe("completed"); expect(calendar.deleteEvent).not.toHaveBeenCalled();
  });
  it("uses current Google event times when deciding whether cleanup is safe", async () => {
    vi.mocked(google.getTask).mockResolvedValue({ id: "google1", status: "completed" });
    vi.mocked(calendar.readEvent).mockResolvedValue({ id: "event1", start: { dateTime: "2026-10-21T14:00:00Z" }, end: { dateTime: "2026-10-21T15:00:00Z" } });
    expect((await syncTask(task, repo, google, calendar, now)).sessionStatus).toBe("elapsed"); expect(calendar.deleteEvent).not.toHaveBeenCalled();
  });
  it("treats a deleted/missing Google Task as intentionally closed", async () => {
    vi.mocked(google.getTask).mockResolvedValue(null);
    expect((await syncTask(task, repo, google, calendar, now)).status).toBe("closed_deleted"); expect(calendar.deleteEvent).toHaveBeenCalledTimes(1);
    expect(google.setDate).not.toHaveBeenCalled();
  });
  it("handles deleted Google Task tombstones", async () => {
    vi.mocked(google.getTask).mockResolvedValue({ id: "google1", deleted: true });
    expect((await syncTask(task, repo, google, calendar, now)).status).toBe("closed_deleted");
  });
  it("does not close a task on an upstream Tasks API error", async () => {
    vi.mocked(google.getTask).mockRejectedValue(new Error("offline"));
    const result = await syncTask(task, repo, google, calendar, now);
    expect(result.status).toBe("scheduled"); expect(result.syncError).toBeTruthy(); expect(calendar.deleteEvent).not.toHaveBeenCalled();
  });
  it("persists completion even if event cleanup fails, then retries cleanup safely", async () => {
    vi.mocked(google.getTask).mockResolvedValue({ id: "google1", status: "completed" });
    vi.mocked(calendar.deleteEvent).mockRejectedValueOnce(new Error("timeout"));
    const first = await syncTask(task, repo, google, calendar, now);
    expect(first.status).toBe("completed"); expect(first.syncError).toBeTruthy();
    expect((await syncTask(task, repo, google, calendar, now)).syncError).toBeNull();
  });
  it("marks all-day conversions for review without inventing timed start/end", async () => {
    vi.mocked(calendar.readEvent).mockResolvedValue({ id: "event1", start: { date: "2026-10-23" }, end: { date: "2026-10-24" } });
    const result = await syncTask(task, repo, google, calendar, now);
    expect(result.status).toBe("needs_review"); expect(result.startAt).toBe("2026-10-23T14:00:00Z"); expect(result.syncError).toContain("all-day");
    expect(google.setDate).not.toHaveBeenCalled();
  });
  it("never schedules a completed, deleted, or review-needed task on submission retry", async () => {
    const scheduling = { busy: vi.fn(), findEvent: vi.fn(), createEvent: vi.fn() } as unknown as CalendarPort;
    const user: User = { id: "user", email: "test@example.com", timezone: "UTC", workStart: "09:00", workEnd: "18:00", sleepStart: "23:00", sleepEnd: "07:00", selectedCalendarIds: ["primary"], rightNowCalendarId: "calendar1" };
    for (const state of ["completed", "closed_deleted", "needs_review"] as const) {
      task.status = state;
      await scheduleTask({ requestId: task.requestId, title: task.title, durationMinutes: task.durationMinutes, deadlineLocal: task.deadlineLocal }, user, repo, scheduling, now);
    }
    expect(scheduling.createEvent).not.toHaveBeenCalled(); expect(scheduling.busy).not.toHaveBeenCalled();
  });
});

describe("Google Task date follows the Calendar session", () => {
  it("replaces the deadline-based date with the day after the event without changing the deadline", async () => {
    vi.mocked(google.getTask).mockResolvedValue({ id: "google1", status: "needsAction", due: "2026-11-01T00:00:00Z" });
    const result = await syncTask(task, repo, google, calendar, now, "America/New_York");
    expect(google.setDate).toHaveBeenCalledWith("list1", "google1", "2026-10-24T00:00:00.000Z");
    expect(result.dueAt).toBe("2026-11-01T23:00:00Z"); expect(result.deadlineLocal).toBe("2026-11-01T18:00");
  });
  it("sets the same derived date when there is no deadline", async () => {
    task.dueAt = null; task.deadlineLocal = null;
    const result = await syncTask(task, repo, google, calendar, now, "America/New_York");
    expect(google.setDate).toHaveBeenCalledWith("list1", "google1", "2026-10-24T00:00:00.000Z");
    expect(result.dueAt).toBeNull(); expect(result.deadlineLocal).toBeNull();
  });
  it("updates the date after an event moves using its local day rather than UTC", async () => {
    vi.mocked(calendar.readEvent).mockResolvedValue({ id: "event1", start: { dateTime: "2026-10-26T01:00:00Z" }, end: { dateTime: "2026-10-26T02:00:00Z" } });
    const result = await syncTask(task, repo, google, calendar, now, "America/New_York");
    expect(google.setDate).toHaveBeenCalledWith("list1", "google1", "2026-10-26T00:00:00.000Z");
    expect(result.sessionStatus).toBe("moved_externally"); expect(result.eventId).toBe("event1");
  });
  it("does not patch an already correct date", async () => {
    vi.mocked(google.getTask).mockResolvedValue({ id: "google1", status: "needsAction", due: "2026-10-24T00:00:00Z" });
    await syncTask(task, repo, google, calendar, now, "America/New_York");
    expect(google.setDate).not.toHaveBeenCalled();
  });
  it("preserves the event mapping after a date update fails and retries on sync", async () => {
    vi.mocked(google.setDate).mockRejectedValueOnce(new Error("timeout"));
    const first = await syncTask(task, repo, google, calendar, now, "America/New_York");
    expect(first).toMatchObject({ status: "scheduled", eventId: "event1", googleTaskId: "google1" }); expect(first.syncError).toBeTruthy();
    expect((await syncTask(task, repo, google, calendar, now, "America/New_York")).syncError).toBeNull();
    expect(google.setDate).toHaveBeenCalledTimes(2); expect(google.createTask).not.toHaveBeenCalled();
  });
  it("leaves an unscheduled task undated", async () => {
    task.status = "unscheduled"; task.calendarId = null; task.eventId = null; task.startAt = null; task.endAt = null;
    await syncTask(task, repo, google, calendar, now, "America/New_York");
    expect(google.setDate).not.toHaveBeenCalled(); expect(calendar.readEvent).not.toHaveBeenCalled();
  });
});
