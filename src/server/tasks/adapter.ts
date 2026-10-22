import "server-only";
import type { OAuth2Client } from "google-auth-library";
import type { Task } from "@/lib/types";
import { AppError } from "../errors";
export type GoogleTask = { id: string; title?: string; notes?: string; due?: string | null; status?: "needsAction" | "completed"; deleted?: boolean; completed?: string; webViewLink?: string };
export interface TasksPort {
  getTask(listId: string, taskId: string): Promise<GoogleTask | null>;
  findByMarker(listId: string, marker: string): Promise<GoogleTask | null>;
  createTask(listId: string, task: Task, marker: string): Promise<GoogleTask>;
  setDate(listId: string, taskId: string, due: string): Promise<void>;
}
// A definitive rejection permits a fresh attempt; an uncertain write never does.
export class GoogleTasksError extends AppError {
  constructor(message: string, status = 502, public connectionCode = "tasks_connection_failed") { super(message, status); }
}
export class TaskWriteRejected extends GoogleTasksError {}
export const taskMarker = (taskId: string) => `[right-now-task:${taskId}]`;
export class TasksAdapter implements TasksPort {
  constructor(private client: OAuth2Client, private transport: typeof fetch = fetch) {}
  private async call<T>(path: string, method = "GET", body?: unknown, allowMissing = false): Promise<T | null> {
    const token = await this.client.getAccessToken();
    const response = await this.transport(`https://tasks.googleapis.com/tasks/v1${path}`, {
      method, headers: { Authorization: `Bearer ${token.token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    if (allowMissing && [404, 410].includes(response.status)) return null;
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: { details?: { reason?: string }[]; errors?: { reason?: string }[] } };
      const reasons = [...(body.error?.details ?? []), ...(body.error?.errors ?? [])].map(detail => detail.reason);
      const disabled = reasons.includes("SERVICE_DISABLED") || reasons.includes("accessNotConfigured");
      const insufficient = reasons.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") || reasons.includes("insufficientPermissions") || response.status === 401;
      const code = disabled ? "tasks_api_disabled" : insufficient ? "tasks_permissions" : "tasks_connection_failed";
      const message = disabled ? "Google Tasks API is disabled for this Google Cloud project. Enable it, wait briefly, and reconnect Google." : insufficient ? "Reconnect Google and approve Tasks access. The current token does not have the required permission." : response.status === 403 ? "Google denied Tasks access. Check your account's app permissions and Google Tasks API configuration." : "Google Tasks could not finish the request. Check the saved task status before retrying.";
      if (method === "POST" && response.status >= 400 && response.status < 500) throw new TaskWriteRejected(message, response.status, code);
      throw new GoogleTasksError(message, response.status === 401 ? 401 : 502, code);
    }
    return response.json() as Promise<T>;
  }
  async ensureList(storedId: string | null | undefined, title: string): Promise<string> {
    if (storedId) {
      if (!await this.call(`/users/@me/lists/${encodeURIComponent(storedId)}`, "GET", undefined, true)) throw new AppError("The Right Now task list was deleted. Existing tasks need review; the list will not be recreated automatically.", 409);
      return storedId;
    }
    let pageToken: string | undefined;
    do {
      const data = await this.call<{ items?: { id: string; title: string }[]; nextPageToken?: string }>(`/users/@me/lists?maxResults=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`);
      const found = data?.items?.find(list => list.title === title);
      if (found) return found.id;
      pageToken = data?.nextPageToken;
    } while (pageToken);
    const created = await this.call<{ id: string }>("/users/@me/lists", "POST", { title });
    if (!created?.id) throw new AppError("Google did not confirm the task list. Reconnect to check its status.", 502);
    return created.id;
  }
  async getTask(listId: string, taskId: string): Promise<GoogleTask | null> {
    return this.call<GoogleTask>(`/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, "GET", undefined, true);
  }
  async findByMarker(listId: string, marker: string): Promise<GoogleTask | null> {
    const matches: GoogleTask[] = [];
    let pageToken: string | undefined;
    do {
      const data = await this.call<{ items?: GoogleTask[]; nextPageToken?: string }>(`/lists/${encodeURIComponent(listId)}/tasks?maxResults=100&showCompleted=true&showHidden=true&showDeleted=true${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`);
      if (!data) throw new AppError("Google did not return the task list. No task was created.", 502);
      matches.push(...(data.items ?? []).filter(task => task.notes?.split("\n").includes(marker)));
      pageToken = data.nextPageToken;
    } while (pageToken);
    if (matches.length > 1) throw new AppError("Multiple Google Tasks match this task. Review the duplicates in Google Tasks; no new task was created.", 409);
    return matches[0] ?? null;
  }
  async createTask(listId: string, task: Task, marker: string): Promise<GoogleTask> {
    // Set the date only after a Calendar session has been saved. The deadline
    // belongs in our DB and notes, not Google's date-only scheduling field.
    const created = await this.call<GoogleTask>(`/lists/${encodeURIComponent(listId)}/tasks`, "POST", {
      title: task.title, status: "needsAction",
      notes: `${marker}\nOriginal task: ${task.title}\nEstimated effort: ${task.durationMinutes} minutes\n${task.dueAt ? `Exact deadline (UTC): ${task.dueAt}` : "No deadline set."}\nThe timed work session is a separate Right Now Calendar event.`,
    });
    if (!created?.id) throw new AppError("Google did not confirm the task ID. Use Sync to recover the result before creating another task.", 502);
    return created;
  }
  async setDate(listId: string, taskId: string, due: string): Promise<void> {
    const updated = await this.call<GoogleTask>(`/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, "PATCH", { due });
    if (updated?.id !== taskId || updated.due?.slice(0, 10) !== due.slice(0, 10)) throw new AppError("Google did not confirm the Task date. The Calendar session is saved; try Sync Google again.", 502);
  }
}
