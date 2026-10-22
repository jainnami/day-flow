export type Interval = { start: string; end: string };
export type Settings = {
  timezone: string; workStart: string; workEnd: string;
  sleepStart: string; sleepEnd: string; selectedCalendarIds: string[];
};
export type User = Settings & {
  id: string; email: string; rightNowCalendarId: string | null; rightNowTaskListId?: string | null;
};
export type TaskInput = { requestId: string; title: string; durationMinutes: number; deadlineLocal: string | null };
export type Task = {
  id: string; userId: string; requestId: string; title: string;
  durationMinutes: number; dueAt: string | null; deadlineLocal: string | null; status: "pending" | "scheduled" | "unscheduled" | "error" | "completed" | "closed_deleted" | "needs_review";
  rationale: string; createdAt: string;
  startAt: string | null; endAt: string | null; calendarId: string | null; eventId: string | null;
  googleTaskListId?: string | null; googleTaskId?: string | null; googleTaskUrl?: string | null;
  googleLinkState?: "unlinked" | "creating" | "linked" | "uncertain";
  googleLinkAttemptId?: string | null; completedAt?: string | null;
  lastSyncedAt?: string | null; syncError?: string | null;
  sessionStatus?: "scheduled" | "elapsed" | "moved_externally" | "removed_externally" | "canceled" | null;
};
