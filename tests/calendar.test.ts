import { describe, expect, it, vi } from "vitest";
import type { OAuth2Client } from "google-auth-library";
import { CalendarAdapter } from "../src/server/calendar/adapter";
const client = { getAccessToken: async () => ({ token: "server-only-token" }) } as OAuth2Client;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
describe("Google Calendar adapter contracts", () => {
  it("reads availability from each requested calendar", async () => {
    const transport = vi.fn<typeof fetch>(async () => json({ calendars: { primary: { busy: [{ start: "2026-10-20T18:00Z", end: "2026-10-20T19:00Z" }] }, work: { busy: [] } } }));
    const result = await new CalendarAdapter(client, transport).busy(["primary", "work"], "2026-10-20T00:00Z", "2026-10-21T00:00Z");
    expect(result).toHaveLength(1);
    expect(transport.mock.calls[0]?.[0]).toBe("https://www.googleapis.com/calendar/v3/freeBusy");
  });
  it("fails closed on per-calendar errors", async () => {
    const adapter = new CalendarAdapter(client, async () => json({ calendars: { primary: { busy: [], errors: [{ reason: "notFound" }] } } }));
    await expect(adapter.busy(["primary"], "2026-10-20T00:00Z", "2026-10-21T00:00Z")).rejects.toThrow("every calendar");
  });
  it("fails closed when Google omits a selected calendar", async () => {
    const adapter = new CalendarAdapter(client, async () => json({ calendars: { primary: { busy: [] } } }));
    await expect(adapter.busy(["primary", "missing"], "2026-10-20T00:00Z", "2026-10-21T00:00Z")).rejects.toThrow("every calendar");
  });
  it("paginates calendar choices", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ items: [{ id: "one", summary: "One" }], nextPageToken: "page two" })).mockResolvedValueOnce(json({ items: [{ id: "two", summary: "Two" }] }));
    expect(await new CalendarAdapter(client, transport).listCalendars()).toHaveLength(2);
    expect(String(transport.mock.calls[1][0])).toContain("pageToken=page%20two");
  });
  it("reuses only the app-marked owned calendar", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ items: [{ id: "unrelated", summary: "Right Now", accessRole: "owner" }, { id: "owned", summary: "Right Now", accessRole: "owner", description: "marker" }] }));
    expect(await new CalendarAdapter(client, transport).ensureCalendar(null, "marker", "UTC")).toBe("owned"); expect(transport).toHaveBeenCalledTimes(1);
  });
  it("does not silently replace a deleted dedicated calendar", async () => {
    await expect(new CalendarAdapter(client, async () => json({}, 404)).ensureCalendar("gone", "marker", "UTC")).rejects.toThrow("missing");
  });
  it("creates an ordinary opaque event with exact times and a private task link", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({ id: "abc", start: { dateTime: "2026-10-20T18:00Z" }, end: { dateTime: "2026-10-20T19:00Z" } }));
    await new CalendarAdapter(client, transport).createEvent("my/calendar", "abc", "Finance", { start: "2026-10-20T18:00Z", end: "2026-10-20T19:00Z" }, "task-1");
    const [url, options] = transport.mock.calls[0];
    expect(url).toBe("https://www.googleapis.com/calendar/v3/calendars/my%2Fcalendar/events");
    expect(JSON.parse(options!.body as string)).toMatchObject({ id: "abc", transparency: "opaque", start: { dateTime: "2026-10-20T18:00Z" }, extendedProperties: { private: { rightNowTaskId: "task-1" } } });
  });
  it("returns reconnect guidance on authorization failure", async () => {
    await expect(new CalendarAdapter(client, async () => json({}, 401)).listCalendars()).rejects.toThrow("Reconnect");
  });
  it("avoids recreating a cancelled event during retry recovery", async () => {
    await expect(new CalendarAdapter(client, async () => json({ id: "abc", status: "cancelled" })).findEvent("right-now", "abc")).rejects.toThrow("not be recreated");
  });
  it("reads missing/deleted events for sync and tolerates repeated cleanup", async () => {
    expect(await new CalendarAdapter(client, async () => json({}, 410)).readEvent("rn", "gone")).toBeNull();
    await expect(new CalendarAdapter(client, async () => new Response(null, { status: 204 })).deleteEvent("rn", "event1")).resolves.toBeUndefined();
    await expect(new CalendarAdapter(client, async () => json({}, 404)).deleteEvent("rn", "event1")).resolves.toBeUndefined();
  });
});
