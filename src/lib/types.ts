export type Interval = { start: string; end: string };
export type Settings = {
  timezone: string; workStart: string; workEnd: string;
  sleepStart: string; sleepEnd: string; selectedCalendarIds: string[];
};
export type User = Settings & {
  id: string; email: string; rightNowCalendarId: string | null;
};
export type TaskInput = { requestId: string; title: string; durationMinutes: number; deadlineLocal: string };
export type Task = {
  id: string; userId: string; requestId: string; title: string;
  durationMinutes: number; dueAt: string; deadlineLocal: string; status: "pending" | "scheduled" | "unscheduled" | "error";
  rationale: string; createdAt: string;
  startAt: string | null; endAt: string | null; calendarId: string | null; eventId: string | null;
};
