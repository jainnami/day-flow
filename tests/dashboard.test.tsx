// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Dashboard } from "../src/components/dashboard";
import type { Task, User } from "../src/lib/types";
const user: User = { id: "test-student", email: "student@example.com", timezone: "America/New_York", workStart: "09:00", workEnd: "18:00", sleepStart: "23:00", sleepEnd: "07:00", selectedCalendarIds: ["primary"], rightNowCalendarId: "right-now" };
const task: Task = { id: "one", userId: user.id, requestId: "request", title: "Finance", durationMinutes: 60, dueAt: "2026-10-21T22:00:00Z", deadlineLocal: "2026-10-21T18:00", status: "scheduled", rationale: "Earliest slot", createdAt: "2026-10-20T18:00:00Z", startAt: "2026-10-20T19:00:00Z", endAt: "2026-10-20T20:00:00Z", calendarId: "right-now", eventId: "event-one" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
afterEach(() => { cleanup(); sessionStorage.clear(); vi.unstubAllGlobals(); });
function dashboard() { return render(<Dashboard initialUser={user} initialTasks={[]} ready tasksConnected autoSync={false} initialMessage="" />); }
function submit() {
  fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Finance" } });
  fireEvent.change(screen.getByLabelText(/Finish by/), { target: { value: "2026-10-21T18:00" } });
  fireEvent.submit(screen.getByRole("button", { name: /Find a time/ }).closest("form")!);
}
describe("Signed-in structured task form", () => {
  it("submits structured fields and displays the returned task in the selected timezone", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json({ task })); vi.stubGlobal("fetch", fetchMock);
    dashboard(); submit();
    await screen.findByRole("heading", { name: "Finance" });
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body).toMatchObject({ title: "Finance", durationMinutes: 60, deadlineLocal: "2026-10-21T18:00" });
    expect(screen.getByText(/Tue, Oct 20, 3:00 PM EDT/)).toBeTruthy();
    expect(sessionStorage.getItem(`rn_pending_${user.id}`)).toBeNull();
  });
  it("keeps the request ID after an uncertain failure so a retry can recover", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValueOnce(json({ task })); vi.stubGlobal("fetch", fetchMock);
    dashboard(); submit(); await screen.findByRole("alert");
    const saved = JSON.parse(sessionStorage.getItem(`rn_pending_${user.id}`)!);
    fireEvent.click(screen.getByRole("button", { name: "Check previous submission" }));
    await screen.findByRole("heading", { name: "Finance" });
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string).requestId).toBe(saved.requestId);
  });
  it("allows correcting input after definitive validation rejection", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(json({ error: "Choose a future deadline." }, 400)));
    dashboard(); submit(); await screen.findByRole("alert");
    expect(sessionStorage.getItem(`rn_pending_${user.id}`)).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("future deadline");
  });
  it("submits a blank optional deadline as null and displays No deadline", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json({ task: { ...task, dueAt: null, deadlineLocal: null } })); vi.stubGlobal("fetch", fetchMock);
    dashboard();
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Finance" } });
    const button = screen.getByRole("button", { name: /Find a time/ });
    expect(button.closest("form")!.checkValidity()).toBe(true);
    fireEvent.submit(button.closest("form")!);
    await screen.findByText("No deadline");
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).deadlineLocal).toBeNull();
  });
  it("shows unallocated work clearly", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(json({ task: { ...task, status: "unscheduled", startAt: null, endAt: null, calendarId: null, eventId: null, rationale: "All 60 minutes remain unallocated." } })));
    dashboard(); submit(); await screen.findByText("No slot available");
    expect(screen.getByText("Work session not allocated")).toBeTruthy();
  });
  it("can recover a persisted error task from a new tab", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(json({ task })); vi.stubGlobal("fetch", fetchMock);
    render(<Dashboard initialUser={user} initialTasks={[{ ...task, status: "error", eventId: null, startAt: null, endAt: null }]} ready tasksConnected autoSync={false} initialMessage="" />);
    fireEvent.click(screen.getByRole("button", { name: "Check this task’s status" }));
    await screen.findByText("Scheduled");
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).requestId).toBe(task.requestId);
  });
  it("saves selected calendar and hour settings", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ calendars: [{ id: "primary", summary: "Personal", primary: true }, { id: "classes", summary: "Classes" }] })).mockResolvedValueOnce(json({ user })); vi.stubGlobal("fetch", fetchMock);
    dashboard(); fireEvent.click(screen.getByRole("button", { name: "Calendar & hours" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Classes" }));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string).selectedCalendarIds).toEqual(["primary", "classes"]);
  });
  it("syncs on app open and displays moved event timing and Google Task link", async () => {
    const updated = { ...task, googleTaskId: "google1", googleTaskListId: "list1", sessionStatus: "moved_externally", startAt: "2026-10-20T21:00:00Z", endAt: "2026-10-20T22:00:00Z" };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ results: [{ id: task.id, error: null }], nextCursor: null })).mockResolvedValueOnce(json({ tasks: [updated] })); vi.stubGlobal("fetch", fetchMock);
    render(<Dashboard initialUser={user} initialTasks={[task]} ready tasksConnected initialMessage="" />);
    await screen.findByText("Work session: Moved in Google Calendar");
    expect(screen.getByText(/Tue, Oct 20, 5:00 PM EDT/)).toBeTruthy(); expect(screen.getByRole("link", { name: "Open Google Tasks ↗" })).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/sync");
  });
  it("follows sync cursors on manual refresh and displays completion", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ results: [], nextCursor: "next-page" })).mockResolvedValueOnce(json({ results: [], nextCursor: null })).mockResolvedValueOnce(json({ tasks: [{ ...task, status: "completed", sessionStatus: "canceled", googleTaskId: "google1" }] })); vi.stubGlobal("fetch", fetchMock);
    render(<Dashboard initialUser={user} initialTasks={[task]} ready tasksConnected autoSync={false} initialMessage="" />);
    fireEvent.click(screen.getByRole("button", { name: "Sync Google ↻" }));
    await screen.findByText("Completed");
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toEqual({ cursor: "next-page" });
    expect(screen.getByText(/Canceled after task closure/)).toBeTruthy();
  });
  it("asks existing Calendar-only users to reconnect for Tasks permission", () => {
    render(<Dashboard initialUser={user} initialTasks={[]} ready tasksConnected={false} initialMessage="" />);
    expect(screen.getByRole("link", { name: "reconnect Google and approve Tasks access" })).toBeTruthy();
    expect((screen.getByRole("button", { name: /Find a time/ }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("shows a partial sync failure while preserving saved task results", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ results: [{ id: task.id, error: "Calendar could not be read" }], nextCursor: null })).mockResolvedValueOnce(json({ tasks: [task] })); vi.stubGlobal("fetch", fetchMock);
    render(<Dashboard initialUser={user} initialTasks={[task]} ready tasksConnected autoSync={false} initialMessage="" />);
    fireEvent.click(screen.getByRole("button", { name: "Sync Google ↻" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Calendar could not be read"); expect(screen.getByRole("heading", { name: "Finance" })).toBeTruthy();
  });
});
