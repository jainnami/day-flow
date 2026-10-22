import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { DataType, newDb } from "pg-mem";
import type { PoolClient } from "pg";
import { linkStore, submitTask, syncExistingTask } from "../src/server/services/task-workflow";
import { connectedCalendar } from "../src/server/calendar/connected";
import { taskRepository } from "../src/server/db/repository";
import { TASKS_SCOPE } from "../src/server/auth/google";
import type { Task } from "../src/lib/types";
import { TasksAdapter } from "../src/server/tasks/adapter";
import type { CalendarAdapter } from "../src/server/calendar/adapter";
const shared = vi.hoisted(() => ({ pool: null as unknown, transactions: 0 }));
vi.mock("../src/server/calendar/connected", () => ({ connectedCalendar: vi.fn() }));
vi.mock("../src/server/db/pool", () => ({
  pool: () => shared.pool,
  userTransaction: async (_userId: string, action: (db: PoolClient) => Promise<unknown>) => {
    shared.transactions++;
    const db = await (shared.pool as { connect: () => Promise<PoolClient> }).connect();
    try { return await action(db); } finally { db.release(); }
  },
}));
let db: PoolClient, userId: string, task: Task;
beforeEach(async () => {
  vi.restoreAllMocks();
  const memory = newDb();
  memory.public.registerFunction({ name: "length", args: [DataType.text], returns: DataType.integer, implementation: (value: string) => value.length });
  memory.public.none(readFileSync("db/migrations/001_milestone_one.sql", "utf8").replace("CHECK (status IN ('pending'", "CONSTRAINT tasks_status_check CHECK (status IN ('pending'"));
  memory.public.none(readFileSync("db/migrations/002_linked_completion.sql", "utf8"));
  memory.public.none(readFileSync("db/migrations/003_optional_deadlines.sql", "utf8"));
  shared.pool = new (memory.adapters.createPg().Pool)(); shared.transactions = 0;
  db = await (shared.pool as { connect: () => Promise<PoolClient> }).connect();
  userId = randomUUID();
  await db.query("INSERT INTO users(id,google_sub,email,right_now_calendar_id,right_now_task_list_id) VALUES($1,'one','one@example.com','calendar1','list1')", [userId]);
  await db.query("INSERT INTO oauth_connections(user_id,encrypted_refresh_token,scopes) VALUES($1,'test-encrypted-token',$2)", [userId, [TASKS_SCOPE]]);
  task = { id: randomUUID(), userId, requestId: randomUUID(), title: "Finance", durationMinutes: 60, deadlineLocal: "2027-01-01T18:00", dueAt: "2027-01-01T23:00:00Z", status: "scheduled", rationale: "Earliest slot", createdAt: "2026-10-22T12:00:00Z", startAt: "2027-01-01T14:00:00Z", endAt: "2027-01-01T15:00:00Z", calendarId: "calendar1", eventId: "event1" };
  await taskRepository(db, userId).insert(task); await taskRepository(db, userId).finish(task);
});
afterEach(() => { db.release(); vi.useRealTimers(); });
describe("Milestone 2 database workflow boundaries", () => {
  it("reserves creation durably in a separate transaction and never grants a second ticket", async () => {
    const store = linkStore(userId, task.requestId);
    const first = await store.reserve(), second = await store.reserve();
    expect(first.ticket).toBeTruthy(); expect(second.ticket).toBeNull();
    expect((await taskRepository(db, userId).find(task.requestId))?.googleLinkState).toBe("creating");
    expect(shared.transactions).toBe(2);
  });
  it("rejects Calendar-only consent before reserving any Google Task write", async () => {
    await db.query("UPDATE oauth_connections SET scopes=$2 WHERE user_id=$1", [userId, ["https://www.googleapis.com/auth/calendar.app.created"]]);
    await expect(linkStore(userId, task.requestId).reserve()).rejects.toThrow("Reconnect");
    expect((await taskRepository(db, userId).find(task.requestId))?.googleLinkState).toBe("unlinked");
  });
  it("cannot reserve another user's task by request ID", async () => {
    const another = randomUUID();
    await db.query("INSERT INTO users(id,google_sub,email) VALUES($1,'two','two@example.com')", [another]);
    await db.query("INSERT INTO oauth_connections(user_id,encrypted_refresh_token,scopes) VALUES($1,'test-token',$2)", [another, [TASKS_SCOPE]]);
    await expect(linkStore(another, task.requestId).reserve()).rejects.toThrow("not found");
  });
  it("retries sync after a saved provider/cleanup error instead of getting stuck", async () => {
    await taskRepository(db, userId).finish({ ...task, googleTaskId: "google1", googleTaskListId: "list1", googleLinkState: "linked", status: "completed", syncError: "Previous cleanup failed" });
    const google = { getTask: vi.fn(async () => ({ id: "google1", status: "completed" as const })), findByMarker: vi.fn(), createTask: vi.fn() } as unknown as TasksAdapter;
    const calendar = { readEvent: vi.fn(async () => ({ id: "event1", start: { dateTime: task.startAt! }, end: { dateTime: task.endAt! } })), deleteEvent: vi.fn(async () => {}) } as unknown as CalendarAdapter;
    const result = await syncExistingTask(userId, task.requestId, "list1", google, calendar, "America/New_York");
    expect(google.getTask).toHaveBeenCalledTimes(1); expect(calendar.deleteEvent).toHaveBeenCalledTimes(1);
    expect(result.syncError).toBeNull(); expect(result.sessionStatus).toBe("canceled");
  });
});

describe("submission sets the Task date after Calendar placement", () => {
  async function setup() {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-22T12:00:00Z"));
    await db.query("DELETE FROM work_sessions WHERE user_id=$1", [userId]);
    await db.query("DELETE FROM tasks WHERE user_id=$1", [userId]);
    const calendar = {
      findEvent: vi.fn(async () => null), busy: vi.fn(async () => []),
      createEvent: vi.fn(async (_calendarId: string, id: string, _title: string, slot: { start: string; end: string }) => ({ id, ...slot })),
      readEvent: vi.fn(async () => {
        const saved = (await taskRepository(db, userId).find(task.requestId))!;
        return { id: saved.eventId!, start: { dateTime: saved.startAt! }, end: { dateTime: saved.endAt! } };
      }), deleteEvent: vi.fn(),
    };
    vi.mocked(connectedCalendar).mockResolvedValue({ adapter: calendar as unknown as CalendarAdapter, client: {} as Awaited<ReturnType<typeof connectedCalendar>>["client"] });
    vi.spyOn(TasksAdapter.prototype, "findByMarker").mockResolvedValue(null);
    const create = vi.spyOn(TasksAdapter.prototype, "createTask").mockResolvedValue({ id: "google1", status: "needsAction" });
    vi.spyOn(TasksAdapter.prototype, "getTask").mockResolvedValue({ id: "google1", status: "needsAction" });
    const setDate = vi.spyOn(TasksAdapter.prototype, "setDate").mockImplementation(async () => {
      const saved = await taskRepository(db, userId).find(task.requestId);
      expect(saved?.eventId).toBeTruthy(); expect(saved?.status).toBe("scheduled");
    });
    // Deadline is a week out; earliest available work is today in New York.
    const input = { requestId: task.requestId, title: "Finance", durationMinutes: 60, deadlineLocal: "2026-10-29T18:00" };
    return { calendar, create, setDate, input };
  }
  it("returns a dated Google Task on first submission and preserves the actual deadline", async () => {
    const { calendar, create, setDate, input } = await setup();
    const result = await submitTask(userId, input);
    expect(result.status).toBe("scheduled"); expect(result.syncError).toBeNull();
    expect(result.deadlineLocal).toBe("2026-10-29T18:00");
    expect(setDate).toHaveBeenCalledWith("list1", "google1", "2026-10-23T00:00:00.000Z");
    expect(calendar.createEvent).toHaveBeenCalledTimes(1); expect(create).toHaveBeenCalledTimes(1);
  });
  it("retains Calendar placement after a failed date write and fixes it on a submission retry", async () => {
    const { calendar, create, setDate, input } = await setup();
    setDate.mockRejectedValueOnce(new Error("network unavailable"));
    const first = await submitTask(userId, input);
    expect(first.status).toBe("scheduled"); expect(first.eventId).toBeTruthy(); expect(first.syncError).toBeTruthy();
    const second = await submitTask(userId, input);
    expect(second.eventId).toBe(first.eventId); expect(second.syncError).toBeNull();
    expect(setDate).toHaveBeenCalledTimes(2); expect(calendar.createEvent).toHaveBeenCalledTimes(1); expect(create).toHaveBeenCalledTimes(1);
  });
});
