import type { Task } from "@/lib/types";
import { googleTaskDate } from "@/lib/google-task-date";
import type { CalendarSyncPort } from "../calendar/adapter";
import type { TasksPort } from "../tasks/adapter";
import { AppError } from "../errors";
import { isClosed, type TaskRepository } from "./schedule-task";
export async function syncTask(original: Task, repo: TaskRepository, google: TasksPort, calendar: CalendarSyncPort, now = new Date().toISOString(), timezone = "UTC"): Promise<Task> {
  const task = { ...original };
  try {
    if (!task.googleTaskId || !task.googleTaskListId) return task;
    const remote = await google.getTask(task.googleTaskListId, task.googleTaskId);
    if (!remote || remote.deleted) {
      task.status = "closed_deleted";
      task.rationale = "The linked Google Task was deleted. This task is intentionally closed; no replacement is created.";
    } else if (remote.status === "completed") {
      task.status = "completed"; task.completedAt = remote.completed ?? task.completedAt ?? now;
      task.rationale = "Completed in Google Tasks. Future work sessions are canceled; started sessions remain historical.";
    } else if (remote.status !== "needsAction") throw new AppError("Google returned an unknown completion state. Existing task and event states were preserved.", 502);
    // Sync only reconciles stored app events; it never creates a work session.
    const calendarId = task.calendarId;
    if (calendarId && task.eventId) {
      const event = await calendar.readEvent(calendarId, task.eventId);
      if (!event || event.status === "cancelled") {
        if (task.sessionStatus !== "canceled") task.sessionStatus = "removed_externally";
        if (!isClosed(task)) { task.status = "needs_review"; task.rationale = "The Calendar work session was removed. The Google Task remains open. No replacement is scheduled automatically."; }
      } else if (!event.start?.dateTime || !event.end?.dateTime) {
        if (!isClosed(task)) task.status = "needs_review";
        throw new AppError("The Calendar event is now all-day or has unsupported timing. Review it in Google Calendar; the saved timed session has been preserved.", 409);
      } else {
        const start = Date.parse(event.start.dateTime), end = Date.parse(event.end.dateTime);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new AppError("Google returned invalid event times. Saved times were preserved.", 502);
        const moved = start !== Date.parse(task.startAt!) || end !== Date.parse(task.endAt!);
        task.startAt = new Date(start).toISOString(); task.endAt = new Date(end).toISOString();
        if (isClosed(task) && start > Date.parse(now)) {
          // Use current Google times, not stale local times, to decide cleanup.
          await calendar.deleteEvent(calendarId, task.eventId);
          task.sessionStatus = "canceled";
        } else if (end <= Date.parse(now)) task.sessionStatus = "elapsed";
        else if (moved || task.sessionStatus === "moved_externally") task.sessionStatus = "moved_externally";
        else task.sessionStatus = "scheduled";
        if (!isClosed(task)) {
          task.status = "scheduled";
          if (moved) task.rationale = "Work session timing was updated from Google Calendar. Your external move was preserved, including any constraint exceptions you made there.";
          const due = googleTaskDate(task.startAt, timezone);
          if (remote?.due?.slice(0, 10) !== due.slice(0, 10)) await google.setDate(task.googleTaskListId, task.googleTaskId, due);
        }
      }
    }
    task.syncError = null; task.lastSyncedAt = now;
  } catch (error) {
    task.syncError = error instanceof AppError ? error.message : "Sync could not finish. Saved links were preserved. Try Sync again.";
  }
  await repo.finish(task);
  return task;
}
