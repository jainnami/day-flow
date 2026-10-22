import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { Settings, Task, User } from "@/lib/types";
import type { TaskRepository } from "../services/schedule-task";
import { pool } from "./pool";
type UserRow = { id: string; email: string; timezone: string; work_start: string; work_end: string; sleep_start: string; sleep_end: string; selected_calendar_ids: string[]; right_now_calendar_id: string | null };
export function userFromRow(r: UserRow): User {
  return { id: r.id, email: r.email, timezone: r.timezone, workStart: r.work_start, workEnd: r.work_end, sleepStart: r.sleep_start, sleepEnd: r.sleep_end, selectedCalendarIds: r.selected_calendar_ids, rightNowCalendarId: r.right_now_calendar_id };
}
export async function getUser(id: string, db: Pick<PoolClient, "query"> = pool()) {
  const result = await db.query("SELECT * FROM users WHERE id=$1", [id]);
  return result.rows[0] ? userFromRow(result.rows[0]) : null;
}
export async function saveSettings(db: PoolClient, userId: string, s: Settings) {
  await db.query("UPDATE users SET timezone=$2,work_start=$3,work_end=$4,sleep_start=$5,sleep_end=$6,selected_calendar_ids=$7 WHERE id=$1", [userId, s.timezone, s.workStart, s.workEnd, s.sleepStart, s.sleepEnd, s.selectedCalendarIds]);
}
const taskSelect = `SELECT t.*,w.google_calendar_id,w.google_event_id,w.start_at,w.end_at FROM tasks t LEFT JOIN work_sessions w ON w.task_id=t.id AND w.user_id=t.user_id`;
function taskFromRow(r: Record<string, unknown>): Task {
  const iso = (v: unknown) => v instanceof Date ? v.toISOString() : v ? String(v) : null;
  return { id: String(r.id), userId: String(r.user_id), requestId: String(r.request_id), title: String(r.title), durationMinutes: Number(r.duration_minutes), dueAt: iso(r.due_at)!, deadlineLocal: String(r.deadline_local), status: r.status as Task["status"], rationale: String(r.rationale), createdAt: iso(r.created_at)!, startAt: iso(r.start_at), endAt: iso(r.end_at), calendarId: r.google_calendar_id as string | null, eventId: r.google_event_id as string | null };
}
export async function listTasks(userId: string) {
  const result = await pool().query(`${taskSelect} WHERE t.user_id=$1 ORDER BY t.created_at DESC LIMIT 100`, [userId]);
  return result.rows.map(taskFromRow);
}
export function taskRepository(db: PoolClient, userId: string): TaskRepository {
  return {
    async find(requestId) { const r = await db.query(`${taskSelect} WHERE t.user_id=$1 AND t.request_id=$2`, [userId, requestId]); return r.rows[0] ? taskFromRow(r.rows[0]) : null; },
    async insert(task) { await db.query("INSERT INTO tasks(id,user_id,request_id,title,duration_minutes,due_at,deadline_local) VALUES($1,$2,$3,$4,$5,$6,$7)", [task.id, userId, task.requestId, task.title, task.durationMinutes, task.dueAt, task.deadlineLocal]); },
    async finish(task) {
      await db.query("UPDATE tasks SET status=$3,rationale=$4 WHERE id=$1 AND user_id=$2", [task.id, userId, task.status, task.rationale]);
      if (task.eventId) await db.query("INSERT INTO work_sessions(id,user_id,task_id,google_calendar_id,google_event_id,start_at,end_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(task_id) DO NOTHING", [randomUUID(), userId, task.id, task.calendarId, task.eventId, task.startAt, task.endAt]);
    },
  };
}
