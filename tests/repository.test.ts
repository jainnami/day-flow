import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataType, newDb } from "pg-mem";
import type { PoolClient } from "pg";
import type { Task } from "../src/lib/types";
import { taskRepository, getUser, listTasks, listSyncPage } from "../src/server/db/repository";
const shared = vi.hoisted(() => ({ pool: null as unknown }));
vi.mock("../src/server/db/pool", () => ({ pool: () => shared.pool }));
let db: PoolClient, first: string, second: string;
beforeEach(async () => {
  const memory = newDb();
  memory.public.registerFunction({ name: "length", args: [DataType.text], returns: DataType.integer, implementation: (value: string) => value.length });
  // pg-mem does not generate PostgreSQL's implicit check-constraint names.
  memory.public.none(readFileSync("db/migrations/001_milestone_one.sql", "utf8").replace("CHECK (status IN ('pending'", "CONSTRAINT tasks_status_check CHECK (status IN ('pending'"));
  memory.public.none(readFileSync("db/migrations/002_linked_completion.sql", "utf8"));
  memory.public.none(readFileSync("db/migrations/003_optional_deadlines.sql", "utf8"));
  const Pool = memory.adapters.createPg().Pool;
  shared.pool = new Pool();
  db = await (shared.pool as { connect: () => Promise<PoolClient> }).connect();
  first = randomUUID(); second = randomUUID();
  await db.query("INSERT INTO users(id,google_sub,email) VALUES($1,'one','one@example.com'),($2,'two','two@example.com')", [first, second]);
});
function task(userId = first): Task {
  return { id: randomUUID(), userId, requestId: randomUUID(), title: "Finance", durationMinutes: 60, dueAt: "2026-10-21T22:00:00Z", deadlineLocal: "2026-10-21T18:00", status: "pending", rationale: "", createdAt: "2026-10-20T18:00:00Z", startAt: null, endAt: null, calendarId: null, eventId: null };
}
describe("SQL migration and user-scoped repositories (pg-mem)", () => {
  it("loads editable user defaults", async () => expect(await getUser(first, db)).toMatchObject({ id: first, timezone: "America/New_York", selectedCalendarIds: ["primary"] }));
  it("persists and reads a task/event mapping", async () => {
    const repo = taskRepository(db, first), t = task(); await repo.insert(t);
    await repo.finish({ ...t, status: "scheduled", calendarId: "right-now", eventId: "event-123", startAt: "2026-10-20T18:00:00Z", endAt: "2026-10-20T19:00:00Z", rationale: "Earliest slot" });
    expect(await repo.find(t.requestId)).toMatchObject({ status: "scheduled", eventId: "event-123", startAt: "2026-10-20T18:00:00.000Z" });
    expect(await listTasks(first)).toHaveLength(1);
  });
  it("does not expose another user's tasks or mapping by request ID", async () => {
    const t = task(); await taskRepository(db, first).insert(t);
    expect(await taskRepository(db, second).find(t.requestId)).toBeNull(); expect(await listTasks(second)).toEqual([]);
    await taskRepository(db, second).finish({ ...t, status: "error", rationale: "foreign update" });
    expect((await taskRepository(db, first).find(t.requestId))?.status).toBe("pending");
  });
  it("enforces per-user request uniqueness and session time ordering", async () => {
    const repo = taskRepository(db, first), t = task(); await repo.insert(t);
    await expect(repo.insert({ ...t, id: randomUUID() })).rejects.toThrow();
    await expect(repo.finish({ ...t, status: "scheduled", calendarId: "rn", eventId: "abc", startAt: "2026-10-20T19:00Z", endAt: "2026-10-20T18:00Z" })).rejects.toThrow();
  });
  it("preserves existing Milestone 1 rows when applying the additive migration", async () => {
    const repo = taskRepository(db, first), t = task(); await repo.insert(t);
    expect(await repo.find(t.requestId)).toMatchObject({ title: "Finance", googleLinkState: "unlinked", googleTaskId: null });
  });
  it("updates moved session times and completion without inserting a second session", async () => {
    const repo = taskRepository(db, first), t = task(); await repo.insert(t);
    const linked: Task = { ...t, status: "scheduled", googleTaskId: "g1", googleTaskListId: "list1", googleLinkState: "linked", calendarId: "rn", eventId: "event1", startAt: "2026-10-23T14:00:00Z", endAt: "2026-10-23T15:00:00Z" };
    await repo.finish(linked);
    await repo.finish({ ...linked, startAt: "2026-10-23T18:00:00Z", endAt: "2026-10-23T19:00:00Z", status: "completed", sessionStatus: "canceled", lastSyncedAt: "2026-10-22T12:00:00Z" });
    expect(await repo.find(t.requestId)).toMatchObject({ googleTaskId: "g1", status: "completed", sessionStatus: "canceled", startAt: "2026-10-23T18:00:00.000Z" });
    expect((await db.query("SELECT count(*) FROM work_sessions WHERE user_id=$1", [first])).rows[0].count).toBe(1);
  });
  it("paginates sync across all tasks without including another user's rows", async () => {
    for (let i = 0; i < 7; i++) await taskRepository(db, first).insert(task());
    await taskRepository(db, second).insert(task(second));
    const ids: string[] = []; let cursor: string | null = null;
    do { const page = await listSyncPage(first, cursor); ids.push(...page.tasks.map(t => t.id)); expect(page.tasks.every(t => t.userId === first)).toBe(true); cursor = page.nextCursor; } while (cursor);
    expect(ids).toHaveLength(7); expect(new Set(ids).size).toBe(7);
  });
  it("persists and reloads a task with genuinely null deadline fields", async () => {
    const repo = taskRepository(db, first), t = { ...task(), dueAt: null, deadlineLocal: null };
    await repo.insert(t);
    expect(await repo.find(t.requestId)).toMatchObject({ dueAt: null, deadlineLocal: null, title: "Finance" });
    expect((await listTasks(first))[0].dueAt).toBeNull();
  });
  it("requires UTC and original local deadline fields to be both present or both absent", async () => {
    await expect(taskRepository(db, first).insert({ ...task(), dueAt: null })).rejects.toThrow();
  });
});
