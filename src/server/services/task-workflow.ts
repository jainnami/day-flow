import "server-only";
import { randomUUID } from "node:crypto";
import type { TaskInput } from "@/lib/types";
import { userTransaction } from "../db/pool";
import { getUser, taskRepository } from "../db/repository";
import { TASKS_SCOPE } from "../auth/google";
import { connectedCalendar } from "../calendar/connected";
import { TasksAdapter } from "../tasks/adapter";
import { AppError } from "../errors";
import { linkGoogleTask, type LinkStore } from "./link-task";
import { isClosed, prepareTask, scheduleTask } from "./schedule-task";
import { syncTask } from "./sync-task";
async function checkConnection(db: import("pg").PoolClient, userId: string) {
  const r = await db.query("SELECT status,scopes FROM oauth_connections WHERE user_id=$1", [userId]);
  if (r.rows[0]?.status !== "connected" || !r.rows[0].scopes.includes(TASKS_SCOPE)) throw new AppError("Reconnect Google to grant Calendar and Tasks access.", 401);
}
export function linkStore(userId: string, requestId: string): LinkStore {
  return {
    reserve: () => userTransaction(userId, async db => {
      await checkConnection(db, userId);
      const repo = taskRepository(db, userId), task = await repo.find(requestId);
      if (!task) throw new AppError("Task not found.", 404);
      if (task.googleTaskId || isClosed(task) || ["creating", "uncertain"].includes(task.googleLinkState ?? "unlinked")) return { task, ticket: null };
      const ticket = randomUUID();
      task.googleLinkState = "creating"; task.googleLinkAttemptId = ticket;
      await repo.finish(task);
      return { task, ticket };
    }),
    run: action => userTransaction(userId, async db => {
      await checkConnection(db, userId);
      const repo = taskRepository(db, userId), task = await repo.find(requestId);
      if (!task) throw new AppError("Task not found.", 404);
      return action(task, repo);
    }),
  };
}
export async function submitTask(userId: string, input: TaskInput) {
  const { adapter, client } = await connectedCalendar(userId, true);
  const user = await userTransaction(userId, async db => {
    await checkConnection(db, userId);
    const user = (await getUser(userId, db))!;
    if (!user.rightNowTaskListId) throw new AppError("Reconnect Google to create your dedicated task list.", 409);
    await prepareTask(input, user, taskRepository(db, userId));
    return user;
  });
  const google = new TasksAdapter(client), store = linkStore(userId, input.requestId);
  const linked = await linkGoogleTask(store, google, user.rightNowTaskListId!);
  if (!linked.googleTaskId) return linked;
  // Refresh completion before attempting any interrupted Calendar write.
  const synced = await store.run((task, repo) => syncTask(task, repo, google, adapter, undefined, user.timezone));
  if (isClosed(synced) || ["needs_review", "scheduled"].includes(synced.status) || synced.syncError) return synced;
  const scheduled = await userTransaction(userId, async db => {
    await checkConnection(db, userId);
    return scheduleTask(input, (await getUser(userId, db))!, taskRepository(db, userId), adapter);
  });
  // Commit the event mapping first. A failed Task date update can then be
  // retried by Sync without losing or creating another Calendar session.
  if (scheduled.status !== "scheduled") return scheduled;
  return store.run((task, repo) => syncTask(task, repo, google, adapter, undefined, user.timezone));
}
export async function syncExistingTask(userId: string, requestId: string, listId: string, google: TasksAdapter, calendar: import("../calendar/adapter").CalendarAdapter, timezone: string) {
  const store = linkStore(userId, requestId);
  const linked = await linkGoogleTask(store, google, listId);
  if (!linked.googleTaskId) return linked;
  return store.run((task, repo) => syncTask(task, repo, google, calendar, undefined, timezone));
}
