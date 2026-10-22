import { readFileSync } from "node:fs";
import { DataType, newDb } from "pg-mem";
import { expect, it } from "vitest";
it("upgrades an existing Milestone 1 task/event without losing either mapping", () => {
  const memory = newDb();
  memory.public.registerFunction({ name: "length", args: [DataType.text], returns: DataType.integer, implementation: (value: string) => value.length });
  memory.public.none(readFileSync("db/migrations/001_milestone_one.sql", "utf8").replace("CHECK (status IN ('pending'", "CONSTRAINT tasks_status_check CHECK (status IN ('pending'"));
  memory.public.none(`INSERT INTO users(id,google_sub,email) VALUES('00000000-0000-4000-8000-000000000001','student','test@example.com');
    INSERT INTO tasks(id,user_id,request_id,title,duration_minutes,due_at,deadline_local,status)
    VALUES('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003','Original task',60,'2026-11-01T18:00:00Z','2026-11-01T18:00','scheduled');
    INSERT INTO work_sessions(id,user_id,task_id,google_calendar_id,google_event_id,start_at,end_at)
    VALUES('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','original-calendar','original-event','2026-10-23T14:00:00Z','2026-10-23T15:00:00Z');`);
  memory.public.none(readFileSync("db/migrations/002_linked_completion.sql", "utf8"));
  memory.public.none(readFileSync("db/migrations/003_optional_deadlines.sql", "utf8"));
  expect(memory.public.one("SELECT title,status,google_link_state,google_task_id,deadline_local FROM tasks")).toMatchObject({ title: "Original task", status: "scheduled", google_link_state: "unlinked", google_task_id: null, deadline_local: "2026-11-01T18:00" });
  expect(memory.public.one("SELECT google_event_id,google_calendar_id,status FROM work_sessions")).toMatchObject({ google_event_id: "original-event", google_calendar_id: "original-calendar", status: "scheduled" });
});
