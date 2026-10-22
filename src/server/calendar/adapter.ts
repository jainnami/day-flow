import "server-only";
import type { OAuth2Client } from "google-auth-library";
import type { Interval } from "@/lib/types";
import { AppError } from "../errors";
export type CalendarChoice = { id: string; summary: string; primary?: boolean; description?: string; accessRole?: string };
export type CalendarEvent = { id: string; start: string; end: string };
export interface CalendarPort {
  busy(calendarIds: string[], from: string, to: string): Promise<Interval[]>;
  findEvent(calendarId: string, eventId: string): Promise<CalendarEvent | null>;
  createEvent(calendarId: string, eventId: string, title: string, slot: Interval, taskId: string): Promise<CalendarEvent>;
}
export class CalendarAdapter implements CalendarPort {
  constructor(private client: OAuth2Client, private transport: typeof fetch = fetch) {}
  private async call<T>(path: string, method = "GET", body?: unknown, allowMissing = false): Promise<T | null> {
    const token = await this.client.getAccessToken();
    const response = await this.transport(`https://www.googleapis.com/calendar/v3${path}`, {
      method, headers: { Authorization: `Bearer ${token.token}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    if (response.status === 404 && allowMissing) return null;
    if (response.status === 401) throw new AppError("Google access expired. Reconnect your Google account.", 401);
    if (response.status === 403) throw new AppError("Google denied Calendar access. Check calendar permissions or reconnect with all requested permissions.", 403);
    if (!response.ok) throw new AppError("Google Calendar could not finish the request. Retry the same submission shortly.", 502);
    return response.json() as Promise<T>;
  }
  async listCalendars(): Promise<CalendarChoice[]> {
    const choices: CalendarChoice[] = [];
    let pageToken: string | undefined;
    do {
      const data = await this.call<{ items?: CalendarChoice[]; nextPageToken?: string }>(`/users/me/calendarList?maxResults=250${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`);
      choices.push(...(data?.items ?? []).filter(c => c.id));
      pageToken = data?.nextPageToken;
    } while (pageToken);
    return choices;
  }
  async ensureCalendar(storedId: string | null, marker: string, timezone: string): Promise<string> {
    if (storedId) {
      // A deleted dedicated calendar requires explicit reconnect/review, never a silent replacement.
      const existing = await this.call<{ id: string }>(`/calendars/${encodeURIComponent(storedId)}`, "GET", undefined, true);
      if (!existing) throw new AppError("The Right Now calendar is missing. Restore it in Google Calendar before scheduling.", 409);
      return storedId;
    }
    const existing = (await this.listCalendars()).find(c => c.description === marker && c.accessRole === "owner");
    if (existing) return existing.id;
    const calendar = await this.call<{ id: string }>("/calendars", "POST", { summary: "Right Now", description: marker, timeZone: timezone });
    if (!calendar?.id) throw new AppError("Google did not return a calendar ID.", 502);
    return calendar.id;
  }
  async busy(calendarIds: string[], from: string, to: string): Promise<Interval[]> {
    const ids = [...new Set(calendarIds)];
    if (!ids.length || ids.length > 50) throw new AppError("Select between 1 and 49 source calendars.");
    const data = await this.call<{ calendars?: Record<string, { busy?: Interval[]; errors?: unknown[] }> }>("/freeBusy", "POST", { timeMin: from, timeMax: to, items: ids.map(id => ({ id })) });
    return ids.flatMap(id => {
      const calendar = data?.calendars?.[id];
      // Missing availability is unknown time, never free time.
      if (!calendar || calendar.errors?.length || !Array.isArray(calendar.busy)) throw new AppError("Availability could not be read for every calendar. Check your selected calendars and retry.", 502);
      return calendar.busy;
    });
  }
  async findEvent(calendarId: string, eventId: string): Promise<CalendarEvent | null> {
    const event = await this.call<{ id: string; status?: string; start?: { dateTime?: string }; end?: { dateTime?: string } }>(`/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`, "GET", undefined, true);
    if (!event) return null;
    if (event.status === "cancelled" || !event.start?.dateTime || !event.end?.dateTime) throw new AppError("This submission's event was changed or deleted in Google. Review it in Google Calendar; it will not be recreated automatically.", 409);
    return { id: event.id, start: event.start.dateTime, end: event.end.dateTime };
  }
  async createEvent(calendarId: string, eventId: string, title: string, slot: Interval, taskId: string): Promise<CalendarEvent> {
    const event = await this.call<{ id: string; start: { dateTime: string }; end: { dateTime: string } }>(`/calendars/${encodeURIComponent(calendarId)}/events`, "POST", {
      id: eventId, summary: title, description: "Scheduled by Right Now. One continuous work session.",
      start: { dateTime: slot.start }, end: { dateTime: slot.end }, transparency: "opaque",
      extendedProperties: { private: { rightNowTaskId: taskId } },
    });
    if (!event?.id || !event.start?.dateTime || !event.end?.dateTime) throw new AppError("Google did not confirm the event. Retry the same submission to recover its status.", 502);
    return { id: event.id, start: event.start.dateTime, end: event.end.dateTime };
  }
}
