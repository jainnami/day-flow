import { describe, expect, it, vi } from "vitest";
import type { OAuth2Client } from "google-auth-library";
import { TasksAdapter, TaskWriteRejected, GoogleTasksError, taskMarker } from "../src/server/tasks/adapter";
import type { Task } from "../src/lib/types";
const client = { getAccessToken: async () => ({ token: "private-token" }) } as OAuth2Client;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const task: Task = { id: "local-1", userId: "u1", requestId: "r1", title: "Finance", durationMinutes: 60, deadlineLocal: "2026-11-01T18:00", dueAt: "2026-11-01T23:00:00Z", status: "pending", rationale: "", createdAt: "2026-10-22T12:00:00Z", startAt: null, endAt: null, calendarId: null, eventId: null };
describe("Google Tasks API adapter", () => {
  it("creates an initially undated Task with a recovery marker and exact deadline in notes", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({ id: "google-1", status: "needsAction" }));
    expect((await new TasksAdapter(client, transport).createTask("list/one", task, taskMarker(task.id))).id).toBe("google-1");
    const [url, options] = transport.mock.calls[0], body = JSON.parse(options!.body as string);
    expect(url).toContain("/lists/list%2Fone/tasks");
    expect(body).not.toHaveProperty("due");
    expect(body.notes).toContain("[right-now-task:local-1]"); expect(body.notes).toContain(task.dueAt!);
    expect(body.id).toBeUndefined();
  });
  it("patches only the date, preserving title, notes and completion", async () => {
    const due = "2026-10-24T00:00:00.000Z";
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({ id: "task/one", due }));
    await new TasksAdapter(client, transport).setDate("list/one", "task/one", due);
    const [url, options] = transport.mock.calls[0];
    expect(url).toContain("/lists/list%2Fone/tasks/task%2Fone"); expect(options!.method).toBe("PATCH");
    expect(JSON.parse(options!.body as string)).toEqual({ due });
  });
  it("reports an unconfirmed or failed date update for sync retry without inserting a Task", async () => {
    const due = "2026-10-24T00:00:00.000Z";
    await expect(new TasksAdapter(client, async () => json({ id: "task1" })).setDate("list", "task1", due)).rejects.toThrow("confirm");
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({}, 404));
    await expect(new TasksAdapter(client, transport).setDate("list", "task1", due)).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1); expect(transport.mock.calls[0][1]!.method).toBe("PATCH");
  });
  it("recovers hidden completed tasks through paginated results", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ items: [{ id: "other", notes: "different" }], nextPageToken: "page 2" })).mockResolvedValueOnce(json({ items: [{ id: "found", notes: `${taskMarker(task.id)}\nDetails`, status: "completed" }] }));
    expect((await new TasksAdapter(client, transport).findByMarker("list", taskMarker(task.id)))?.id).toBe("found");
    expect(transport.mock.calls[0][0]).toContain("showCompleted=true&showHidden=true&showDeleted=true");
    expect(transport.mock.calls[1][0]).toContain("pageToken=page%202");
  });
  it("requires a complete marker line and refuses duplicate matches", async () => {
    const adapter = new TasksAdapter(client, async () => json({ items: [{ id: "1", notes: taskMarker(task.id) }, { id: "2", notes: taskMarker(task.id) }] }));
    await expect(adapter.findByMarker("list", taskMarker(task.id))).rejects.toThrow("Multiple");
    expect(await new TasksAdapter(client, async () => json({ items: [{ id: "1", notes: taskMarker(task.id) + "extra" }] })).findByMarker("list", taskMarker(task.id))).toBeNull();
  });
  it("recognizes missing/deleted Tasks but does not interpret forbidden access as deletion", async () => {
    expect(await new TasksAdapter(client, async () => json({}, 404)).getTask("list", "gone")).toBeNull();
    expect(await new TasksAdapter(client, async () => json({}, 410)).getTask("list", "gone")).toBeNull();
    await expect(new TasksAdapter(client, async () => json({}, 403)).getTask("list", "private")).rejects.toThrow("denied");
  });
  it("distinguishes an explicit rejected write from an uncertain server failure", async () => {
    await expect(new TasksAdapter(client, async () => json({}, 403)).createTask("list", task, "marker")).rejects.toBeInstanceOf(TaskWriteRejected);
    try { await new TasksAdapter(client, async () => json({}, 500)).createTask("list", task, "marker"); throw new Error("Expected failure"); }
    catch (error) { expect(error).not.toBeInstanceOf(TaskWriteRejected); }
  });
  it("recovers the dedicated task list by its stable title", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ items: [{ id: "existing", title: "Right Now (app123)" }] }));
    expect(await new TasksAdapter(client, transport).ensureList(null, "Right Now (app123)")).toBe("existing"); expect(transport).toHaveBeenCalledTimes(1);
  });
  it("does not recreate a deleted dedicated task list", async () => {
    await expect(new TasksAdapter(client, async () => json({}, 404)).ensureList("gone", "Right Now")).rejects.toThrow("not be recreated");
  });
  it("rejects a successful HTTP response without a confirmed Task ID", async () => {
    await expect(new TasksAdapter(client, async () => json({})).createTask("list", task, "marker")).rejects.toThrow("confirm");
  });
  it("omits Google's due field entirely when no deadline was provided", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({ id: "google-no-deadline", status: "needsAction" }));
    await new TasksAdapter(client, transport).createTask("list", { ...task, dueAt: null, deadlineLocal: null }, "marker");
    const body = JSON.parse(transport.mock.calls[0][1]!.body as string);
    expect(body).not.toHaveProperty("due"); expect(body.notes).toContain("No deadline set."); expect(body.notes).not.toContain("null");
  });
  it.each([["SERVICE_DISABLED", "tasks_api_disabled"], ["ACCESS_TOKEN_SCOPE_INSUFFICIENT", "tasks_permissions"]])("identifies the provider's %s setup failure", async (reason, expected) => {
    try { await new TasksAdapter(client, async () => json({ error: { details: [{ reason }] } }, 403)).ensureList(null, "Right Now"); throw new Error("Expected rejection"); }
    catch (error) { expect(error).toBeInstanceOf(GoogleTasksError); expect((error as GoogleTasksError).connectionCode).toBe(expected); }
  });
});
