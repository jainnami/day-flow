import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eventIdFor, scheduleTask, type TaskRepository } from "../src/server/services/schedule-task";
import type { CalendarPort } from "../src/server/calendar/adapter";
import type { Task, TaskInput, User } from "../src/lib/types";
import { taskSchema } from "../src/lib/validation";
const now = "2026-10-20T18:00:00Z";
const user: User = { id: randomUUID(), email: "student@example.com", timezone: "America/New_York", workStart: "09:00", workEnd: "18:00", sleepStart: "23:00", sleepEnd: "07:00", selectedCalendarIds: ["primary", "classes"], rightNowCalendarId: "right-now" };
let stored: Task | null;
let repo: TaskRepository;
let calendar: CalendarPort;
let input: TaskInput;
beforeEach(() => {
  stored = null;
  input = { requestId: randomUUID(), title: "Finance problem set", durationMinutes: 60, deadlineLocal: "2026-10-21T18:00" };
  repo = { find: vi.fn(async () => stored ? { ...stored } : null), insert: vi.fn(async task => { stored = { ...task }; }), finish: vi.fn(async task => { stored = { ...task }; }) };
  calendar = { busy: vi.fn(async () => []), findEvent: vi.fn(async () => null), createEvent: vi.fn(async (_calendarId, id, _title, slot) => ({ id, ...slot })) };
});
describe("Calendar-only vertical slice service", () => {
  it("persists the task, event mapping and exact scheduled times", async () => {
    const task = await scheduleTask(input, user, repo, calendar, now);
    expect(task).toMatchObject({ status: "scheduled", calendarId: "right-now", startAt: "2026-10-20T18:00:00.000Z", endAt: "2026-10-20T19:00:00.000Z" });
    expect(stored).toEqual(task);
    expect(calendar.createEvent).toHaveBeenCalledWith("right-now", eventIdFor(user.id, input.requestId), input.title, { start: task.startAt, end: task.endAt }, task.id);
  });
  it("checks selected calendars plus Right Now, then rechecks before writing", async () => {
    await scheduleTask(input, user, repo, calendar, now);
    expect(calendar.busy).toHaveBeenCalledTimes(2);
    expect(calendar.busy).toHaveBeenNthCalledWith(1, ["primary", "classes", "right-now"], now, "2026-10-21T22:00:00Z");
    expect(calendar.busy).toHaveBeenNthCalledWith(2, ["primary", "classes", "right-now"], "2026-10-20T18:00:00.000Z", "2026-10-20T19:00:00.000Z");
  });
  it("repeated submission returns its mapping without another Google write", async () => {
    const first = await scheduleTask(input, user, repo, calendar, now);
    expect(await scheduleTask(input, user, repo, calendar, now)).toEqual(first);
    expect(calendar.createEvent).toHaveBeenCalledTimes(1);
  });
  it("rejects reuse of a request ID with changed task input", async () => {
    await scheduleTask(input, user, repo, calendar, now);
    await expect(scheduleTask({ ...input, title: "Different task" }, user, repo, calendar, now)).rejects.toThrow("different task");
  });
  it("recovers an event after a successful remote write and lost local commit", async () => {
    vi.mocked(calendar.findEvent).mockResolvedValue({ id: eventIdFor(user.id, input.requestId), start: "2026-10-20T19:00:00Z", end: "2026-10-20T20:00:00Z" });
    const task = await scheduleTask(input, user, repo, calendar, now);
    expect(task.status).toBe("scheduled"); expect(task.startAt).toBe("2026-10-20T19:00:00Z");
    expect(calendar.createEvent).not.toHaveBeenCalled(); expect(calendar.busy).not.toHaveBeenCalled();
  });
  it("saves a clear shortfall without writing an event when no full slot fits", async () => {
    const task = await scheduleTask({ ...input, durationMinutes: 180, deadlineLocal: "2026-10-20T15:00" }, user, repo, calendar, now);
    expect(task.status).toBe("unscheduled"); expect(task.rationale).toContain("180 minutes remain unallocated"); expect(calendar.createEvent).not.toHaveBeenCalled();
  });
  it("does not write when availability changed during scheduling", async () => {
    vi.mocked(calendar.busy).mockResolvedValueOnce([]).mockResolvedValueOnce([{ start: now, end: "2026-10-20T19:00:00Z" }]);
    const task = await scheduleTask(input, user, repo, calendar, now);
    expect(task.status).toBe("error"); expect(task.rationale).toContain("calendar changed"); expect(calendar.createEvent).not.toHaveBeenCalled();
  });
  it("persists a recoverable error when Google fails", async () => {
    vi.mocked(calendar.createEvent).mockRejectedValue(new Error("sensitive upstream details"));
    const task = await scheduleTask(input, user, repo, calendar, now);
    expect(task.status).toBe("error"); expect(stored?.status).toBe("error"); expect(task.rationale).not.toContain("sensitive");
  });
  it("retains the same event ID when retrying an error", async () => {
    vi.mocked(calendar.createEvent).mockRejectedValueOnce(new Error("timeout"));
    await scheduleTask(input, user, repo, calendar, now);
    const result = await scheduleTask(input, user, repo, calendar, now);
    expect(result.status).toBe("scheduled");
    expect(vi.mocked(calendar.createEvent).mock.calls.map(c => c[1])).toEqual([result.eventId, result.eventId]);
  });
  it("keeps a saved deadline stable after a timezone setting change", async () => {
    vi.mocked(calendar.createEvent).mockRejectedValueOnce(new Error("timeout"));
    await scheduleTask(input, user, repo, calendar, now);
    const result = await scheduleTask(input, { ...user, timezone: "Asia/Kolkata" }, repo, calendar, now);
    expect(result.dueAt).toBe("2026-10-21T22:00:00Z");
  });
  it("rejects past deadlines before saving", async () => {
    await expect(scheduleTask({ ...input, deadlineLocal: "2026-10-19T18:00" }, user, repo, calendar, now)).rejects.toThrow("passed"); expect(repo.insert).not.toHaveBeenCalled();
  });
  it("rejects deadlines outside the explicit 90-day window", async () => {
    await expect(scheduleTask({ ...input, deadlineLocal: "2027-10-19T18:00" }, user, repo, calendar, now)).rejects.toThrow("90 days");
  });
  it("uses different remote IDs for different users", () => expect(eventIdFor(user.id, input.requestId)).not.toBe(eventIdFor(randomUUID(), input.requestId)));
  it("schedules a deadline-free task without inventing a due date", async () => {
    vi.mocked(calendar.busy).mockResolvedValueOnce([{ start: now, end: "2026-10-20T19:00:00Z" }]).mockResolvedValueOnce([]);
    const result = await scheduleTask({ ...input, deadlineLocal: null }, user, repo, calendar, now);
    expect(result).toMatchObject({ status: "scheduled", dueAt: null, deadlineLocal: null, startAt: "2026-10-20T19:00:00.000Z" });
    expect(stored?.dueAt).toBeNull(); expect(result.rationale).toContain("No deadline was set");
    expect(calendar.busy).toHaveBeenNthCalledWith(1, expect.any(Array), now, new Date(Date.parse(now) + 90 * 86400000).toISOString());
  });
  it("keeps the same event on retry of a task with no deadline", async () => {
    const request = { ...input, deadlineLocal: null };
    const first = await scheduleTask(request, user, repo, calendar, now);
    expect(await scheduleTask(request, user, repo, calendar, now)).toEqual(first); expect(calendar.createEvent).toHaveBeenCalledTimes(1);
  });
  it("reports no availability within the search window without manufacturing a deadline", async () => {
    vi.mocked(calendar.busy).mockResolvedValue([{ start: now, end: "2027-01-20T18:00:00Z" }]);
    const result = await scheduleTask({ ...input, deadlineLocal: null }, user, repo, calendar, now);
    expect(result.status).toBe("unscheduled"); expect(result.dueAt).toBeNull(); expect(result.rationale).toContain("next 90 days"); expect(result.rationale).toContain("No deadline has been set"); expect(calendar.createEvent).not.toHaveBeenCalled();
  });
  it.each([null, "", undefined])("normalizes a missing deadline (%s) consistently", value => {
    const parsed = taskSchema.parse({ ...input, deadlineLocal: value }); expect(parsed.deadlineLocal).toBeNull();
  });
  it("still rejects malformed nonempty deadlines", () => expect(taskSchema.safeParse({ ...input, deadlineLocal: "not-a-date" }).success).toBe(false));
});
