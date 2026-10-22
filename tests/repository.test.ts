import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataType, newDb } from "pg-mem";
import type { PoolClient } from "pg";
import type { Task } from "../src/lib/types";
import { taskRepository, getUser, listTasks } from "../src/server/db/repository";
const shared = vi.hoisted(() => ({ pool: null as unknown }));
vi.mock("../src/server/db/pool", () => ({ pool: () => shared.pool }));
let db: PoolClient, first: string, second: string;
beforeEach(async () => {
  const memory = newDb();
  memory.public.registerFunction({ name: "length", args: [DataType.text], returns: DataType.integer, implementation: (value: string) => value.length });
  memory.public.none(readFileSync("db/migrations/001_milestone_one.sql", "utf8"));
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
});
