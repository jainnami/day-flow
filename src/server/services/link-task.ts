import type { Task } from "@/lib/types";
import { AppError } from "../errors";
import { taskMarker, TaskWriteRejected, type TasksPort } from "../tasks/adapter";
import type { TaskRepository } from "./schedule-task";
import { isClosed } from "./schedule-task";
export type LinkReservation = { task: Task; ticket: string | null };
export interface LinkStore {
  // This operation MUST commit the creation intent before returning a ticket.
  reserve(): Promise<LinkReservation>;
  run<T>(action: (task: Task, repo: TaskRepository) => Promise<T>): Promise<T>;
}
export async function linkGoogleTask(store: LinkStore, google: TasksPort, listId: string): Promise<Task> {
  const reservation = await store.reserve();
  return store.run(async (task, repo) => {
    if (task.googleTaskId || isClosed(task)) return task;
    const marker = taskMarker(task.id);
    let attemptedCreate = false;
    try {
      let remote = await google.findByMarker(listId, marker);
      if (!remote) {
        if (!reservation.ticket || task.googleLinkAttemptId !== reservation.ticket) {
          task.googleLinkState = "uncertain";
          task.syncError = "Google Task creation was interrupted and its result is not yet confirmed. Sync again to check. No replacement will be created automatically.";
          await repo.finish(task); return task;
        }
        attemptedCreate = true;
        remote = await google.createTask(listId, task, marker);
      }
      task.googleTaskListId = listId; task.googleTaskId = remote.id;
      task.googleTaskUrl = remote.webViewLink?.startsWith("https://tasks.google.com/") ? remote.webViewLink : null;
      task.googleLinkState = "linked"; task.syncError = null;
      if (remote.deleted) { task.status = "closed_deleted"; task.rationale = "The linked Google Task was deleted. This task is intentionally closed."; }
      else if (remote.status === "completed") { task.status = "completed"; task.completedAt = remote.completed ?? new Date().toISOString(); task.rationale = "Completed in Google Tasks."; }
      await repo.finish(task); return task;
    } catch (error) {
      if (attemptedCreate && error instanceof TaskWriteRejected) task.googleLinkState = "unlinked";
      task.syncError = error instanceof AppError ? error.message : "Google Tasks could not be reached. Sync again to check the saved status.";
      // A failed read did not perform a write, so the next attempt is safe to reserve.
      if (!attemptedCreate && reservation.ticket && task.googleLinkAttemptId === reservation.ticket) task.googleLinkState = "unlinked";
      if (attemptedCreate && !(error instanceof TaskWriteRejected)) task.googleLinkState = "uncertain";
      await repo.finish(task); return task;
    }
  });
}
