import { createHash, randomUUID } from "node:crypto";
import type { Interval, Task, TaskInput, User } from "@/lib/types";
import { deadlineToUtc } from "@/lib/validation";
import { earliestSlot, MAX_HORIZON_DAYS, overlaps } from "@/lib/scheduler";
import type { CalendarPort } from "../calendar/adapter";
import { AppError } from "../errors";
export interface TaskRepository {
  find(requestId: string): Promise<Task | null>;
  insert(task: Task): Promise<void>;
  finish(task: Task): Promise<void>;
}
export const eventIdFor = (userId: string, requestId: string) => createHash("sha256").update(`${userId}:${requestId}`).digest("hex");
export async function prepareTask(input: TaskInput, user: User, repo: TaskRepository, now = new Date().toISOString()): Promise<Task> {
  let task = await repo.find(input.requestId);
  const deadlineLocal = input.deadlineLocal || null;
  if (task) {
    if (task.title !== input.title || task.durationMinutes !== input.durationMinutes || task.deadlineLocal !== deadlineLocal) throw new AppError("This submission ID belongs to a different task. Start a new submission.", 409);
    return task;
  }
  let dueAt: string | null = null;
  try { if (deadlineLocal) dueAt = deadlineToUtc(deadlineLocal, user.timezone); } catch (e) { throw new AppError((e as Error).message); }
  if (!user.rightNowCalendarId) throw new AppError("Connect your Right Now calendar first.", 409);
  if (!task) {
    if (dueAt && Date.parse(dueAt) <= Date.parse(now)) throw new AppError("The deadline has passed. Choose a future deadline or leave it blank.");
    if (dueAt && Date.parse(dueAt) - Date.parse(now) > MAX_HORIZON_DAYS * 86400000) throw new AppError("Choose a deadline within the next 90 days.");
    task = { id: randomUUID(), userId: user.id, requestId: input.requestId, title: input.title, durationMinutes: input.durationMinutes, dueAt, deadlineLocal, status: "pending", rationale: "", createdAt: now, startAt: null, endAt: null, calendarId: null, eventId: null };
    await repo.insert(task);
  }
  return task;
}
export const isClosed = (task: Task) => task.status === "completed" || task.status === "closed_deleted";
export async function scheduleTask(input: TaskInput, user: User, repo: TaskRepository, calendar: CalendarPort, now = new Date().toISOString()): Promise<Task> {
  let task = await prepareTask(input, user, repo, now);
  if (isClosed(task) || ["scheduled", "unscheduled", "needs_review"].includes(task.status) || task.sessionStatus === "removed_externally" || task.sessionStatus === "canceled") return task;
  const dueAt = task.dueAt;
  // A search limit is not a task deadline: keep deadline-free tasks null in storage.
  const searchEnd = dueAt ?? new Date(Date.parse(now) + MAX_HORIZON_DAYS * 86400000).toISOString();
  if (!user.rightNowCalendarId) throw new AppError("Connect your Right Now calendar first.", 409);
  const eventId = eventIdFor(user.id, input.requestId);
  try {
    // Recover a prior successful Google write if the local transaction failed afterward.
    let event = await calendar.findEvent(user.rightNowCalendarId, eventId);
    if (!event) {
      if (dueAt && Date.parse(dueAt) <= Date.parse(now)) {
        task.status = "unscheduled"; task.rationale = `The deadline has passed. All ${task.durationMinutes} minutes remain unallocated. No event was created.`;
        await repo.finish(task); return task;
      }
      const ids = [...new Set([...user.selectedCalendarIds, user.rightNowCalendarId])];
      const busy = await calendar.busy(ids, now, searchEnd);
      const slot = earliestSlot({ now, dueAt: searchEnd, durationMinutes: task.durationMinutes, settings: user, busy });
      if (!slot) {
        task.status = "unscheduled";
        task.rationale = `No continuous ${task.durationMinutes}-minute slot fits ${dueAt ? "before the deadline" : `within the next ${MAX_HORIZON_DAYS} days`} within your working hours and outside sleep and busy time. All ${task.durationMinutes} minutes remain unallocated.${dueAt ? "" : " No deadline has been set."}`;
        await repo.finish(task); return task;
      }
      // Narrow the race window by checking current availability immediately before writing.
      const latest = await calendar.busy(ids, slot.start, slot.end);
      if (latest.some((b: Interval) => overlaps(slot, b))) throw new AppError("Your calendar changed while scheduling. No event was created. Retry the same submission.", 409);
      event = await calendar.createEvent(user.rightNowCalendarId, eventId, task.title, slot, task.id);
    }
    task = { ...task, status: "scheduled", sessionStatus: "scheduled", startAt: event.start, endAt: event.end, calendarId: user.rightNowCalendarId, eventId: event.id,
      rationale: `Earliest continuous slot available at scheduling time, within working hours and outside protected sleep. ${dueAt ? "The session ends by the deadline." : `No deadline was set; availability was searched within the next ${MAX_HORIZON_DAYS} days.`} Availability was checked again before the event write.` };
    await repo.finish(task);
    return task;
  } catch (error) {
    task.status = "error";
    task.rationale = error instanceof AppError ? error.message : "Scheduling was interrupted. Retry the same submission to check whether Google created the event.";
    await repo.finish(task);
    return task;
  }
}
