import { beforeEach, describe, expect, it, vi } from "vitest";
import { linkGoogleTask, type LinkStore } from "../src/server/services/link-task";
import { TaskWriteRejected, type TasksPort } from "../src/server/tasks/adapter";
import type { Task } from "../src/lib/types";
import type { TaskRepository } from "../src/server/services/schedule-task";
let task: Task, store: LinkStore, google: TasksPort, repo: TaskRepository;
beforeEach(() => {
  task = { id: "local", userId: "user", requestId: "req", title: "Finance", durationMinutes: 60, deadlineLocal: "2026-11-01T18:00", dueAt: "2026-11-01T23:00:00Z", status: "pending", rationale: "", createdAt: "2026-10-22T12:00:00Z", startAt: null, endAt: null, calendarId: null, eventId: null, googleLinkState: "unlinked" };
  repo = { find: async () => task, insert: async () => {}, finish: vi.fn(async updated => { task = { ...updated }; }) };
  store = {
    reserve: async () => {
      if (task.googleTaskId || task.googleLinkState !== "unlinked") return { task: { ...task }, ticket: null };
      task.googleLinkState = "creating"; task.googleLinkAttemptId = "attempt1";
      return { task: { ...task }, ticket: "attempt1" };
    },
    run: async action => action({ ...task }, repo),
  };
  google = { getTask: vi.fn(async () => null), findByMarker: vi.fn(async () => null), createTask: vi.fn(async () => ({ id: "google1", status: "needsAction" as const })), setDate: vi.fn(async () => {}) };
});
describe("Durable Google Task creation and recovery", () => {
  it("records intent before writing and persists the two Google IDs", async () => {
    vi.mocked(google.createTask).mockImplementation(async () => { expect(task.googleLinkState).toBe("creating"); return { id: "google1" }; });
    expect(await linkGoogleTask(store, google, "list1")).toMatchObject({ googleTaskId: "google1", googleTaskListId: "list1", googleLinkState: "linked" });
  });
  it("repeated submissions do not create another Google Task", async () => {
    await linkGoogleTask(store, google, "list1"); await linkGoogleTask(store, google, "list1");
    expect(google.createTask).toHaveBeenCalledTimes(1);
  });
  it("recovers a remote write after local response/commit loss", async () => {
    task.googleLinkState = "creating"; task.googleLinkAttemptId = "old-attempt";
    vi.mocked(google.findByMarker).mockResolvedValue({ id: "recovered", status: "needsAction" });
    expect((await linkGoogleTask(store, google, "list1")).googleTaskId).toBe("recovered"); expect(google.createTask).not.toHaveBeenCalled();
  });
  it("does not issue a second insert if a prior write cannot be confirmed", async () => {
    task.googleLinkState = "creating"; task.googleLinkAttemptId = "old-attempt";
    const result = await linkGoogleTask(store, google, "list1");
    expect(result.googleLinkState).toBe("uncertain"); expect(result.syncError).toContain("No replacement"); expect(google.createTask).not.toHaveBeenCalled();
  });
  it("keeps uncertain creation state on a timeout and checks again without inserting", async () => {
    vi.mocked(google.createTask).mockRejectedValue(new Error("timeout"));
    await linkGoogleTask(store, google, "list1");
    expect(task.googleLinkState).toBe("uncertain");
    await linkGoogleTask(store, google, "list1"); expect(google.createTask).toHaveBeenCalledTimes(1);
  });
  it("allows retry after a definitive provider rejection", async () => {
    vi.mocked(google.createTask).mockRejectedValueOnce(new TaskWriteRejected("API disabled", 403));
    await linkGoogleTask(store, google, "list1"); expect(task.googleLinkState).toBe("unlinked");
    await linkGoogleTask(store, google, "list1"); expect(task.googleTaskId).toBe("google1");
  });
  it("allows a fresh attempt after a read failure that never wrote anything", async () => {
    vi.mocked(google.findByMarker).mockRejectedValueOnce(new Error("offline"));
    await linkGoogleTask(store, google, "list1"); expect(task.googleLinkState).toBe("unlinked"); expect(google.createTask).not.toHaveBeenCalled();
  });
  it("honors completed/deleted recovered objects without making a replacement", async () => {
    vi.mocked(google.findByMarker).mockResolvedValue({ id: "closed", deleted: true });
    expect((await linkGoogleTask(store, google, "list1")).status).toBe("closed_deleted"); expect(google.createTask).not.toHaveBeenCalled();
  });
  it("does not expose an untrusted provider link in the UI", async () => {
    vi.mocked(google.createTask).mockResolvedValue({ id: "google1", webViewLink: "javascript:alert(1)" });
    expect((await linkGoogleTask(store, google, "list1")).googleTaskUrl).toBeNull();
  });
});
