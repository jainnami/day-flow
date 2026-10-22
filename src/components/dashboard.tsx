"use client";
import { useState } from "react";
import type { Settings, Task, TaskInput, User } from "@/lib/types";
type Choice = { id: string; summary: string; primary?: boolean };
class ApiError extends Error { constructor(message: string, public status: number) { super(message); } }
async function api(path: string, body?: unknown) {
  const response = await fetch(path, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok && !data.task) throw new ApiError(data.error || "The request could not finish. Try again.", response.status);
  return data;
}
function displayTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
}
function restorePending(userId: string): TaskInput | null {
  try { return JSON.parse(sessionStorage.getItem(`rn_pending_${userId}`) ?? "null"); } catch { return null; }
}
export function Dashboard({ initialUser, initialTasks, ready, initialMessage }: { initialUser: User | null; initialTasks: Task[]; ready: boolean; initialMessage: string }) {
  const [user, setUser] = useState(initialUser), [tasks, setTasks] = useState(initialTasks);
  const [message, setMessage] = useState(initialMessage), [error, setError] = useState("");
  const [working, setWorking] = useState(false), [choices, setChoices] = useState<Choice[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(initialUser);
  const [showSettings, setShowSettings] = useState(false), [retry, setRetry] = useState<TaskInput | null>(null);
  const [title, setTitle] = useState(""), [duration, setDuration] = useState("60"), [deadline, setDeadline] = useState("");
  async function act(run: () => Promise<void>) {
    setWorking(true); setError(""); setMessage("");
    try { await run(); } catch (e) { setError((e as Error).message); } finally { setWorking(false); }
  }
  async function schedule(input: TaskInput) {
    if (!user) return;
    const pending = retry || restorePending(user.id);
    if (pending && pending.requestId !== input.requestId) throw new Error("Check the previous interrupted submission before retrying another task.");
    setRetry(input);
    sessionStorage.setItem(`rn_pending_${user.id}`, JSON.stringify(input));
    let data;
    try { data = await api("/api/tasks", input); }
    catch (e) {
      if (e instanceof ApiError && [400, 413, 415].includes(e.status)) { sessionStorage.removeItem(`rn_pending_${user.id}`); setRetry(null); }
      throw e;
    }
    const task = data.task as Task;
    setTasks(previous => [task, ...previous.filter(t => t.id !== task.id)]);
    if (task.status === "error") { setError(task.rationale); return; }
    sessionStorage.removeItem(`rn_pending_${user.id}`); setRetry(null);
    setTitle(""); setDeadline("");
    setMessage(task.status === "scheduled" ? "Your work session is in Google Calendar." : "Task saved. No full session fits before the deadline.");
  }
  async function openSettings() {
    await act(async () => {
      if (!showSettings) { setChoices((await api("/api/calendars")).calendars); setSettings(user); }
      setShowSettings(!showSettings);
    });
  }
  const scheduled = tasks.filter(t => t.status === "scheduled").length;
  return <div className="shell">
    <header className="topbar"><a className="brand" href="/" aria-label="Right Now home"><span className="brand-mark">r<span>n</span></span>right now<span className="brand-dot">.</span></a><span className="milestone">CALENDAR PILOT <span>01</span></span></header>
    <main>
      {message && <div className="notice" role="status">{message}</div>}
      {error && <div className="notice error" role="alert">{error}</div>}
      {!user ? <>
        <section className="welcome">
          <div><p className="eyebrow"><span className="small-dot" /> LESS PLANNING. MORE STARTING.</p><h1>Your next task.<br /><em>A time to start.</em></h1><p className="intro">Turn an open to-do into a realistic work session. Right Now finds a free spot in your Google Calendar, around the life already in it.</p>
            {ready ? <a className="button primary connect" href="/api/auth/google"><span className="google-g">G</span> Connect Google Calendar <span aria-hidden="true">↗</span></a> : <div className="setup"><strong>One small setup before we start.</strong><p>Add your Google credentials and PostgreSQL connection to <code>.env.local</code>, then run the migration. Follow the steps in <code>README.md</code>.</p></div>}
            <p className="fine-print">Checks availability. Creates work sessions in a dedicated Right Now calendar.</p>
          </div>
          <div className="calendar-preview" aria-label="Illustration of a free calendar slot becoming a work session">
            <div className="preview-top"><span>A LITTLE ROOM FOR PROGRESS</span><span className="preview-sun">✳</span></div>
            <div className="preview-date">Your afternoon, with a plan.</div>
            <div className="preview-row"><span>1 PM</span><div className="preview-event existing">Class <small>Already on your calendar</small></div></div>
            <div className="preview-row"><span>2 PM</span><div className="preview-event focus"><span>↗ &nbsp; Finance problem set</span><small>60 min · A free slot, found for you</small></div></div>
            <div className="preview-row"><span>3 PM</span><div className="preview-free">Room to breathe.</div></div>
            <p className="preview-caption">ILLUSTRATIVE SCHEDULE</p>
          </div>
        </section>
        <section className="how"><article><span>01 / CAPTURE</span><h2>Give it a shape.</h2><p>A title, an estimate, and a deadline. That’s enough to begin.</p></article><article><span>02 / FIND TIME</span><h2>Make it realistic.</h2><p>Your commitments, working hours, and sleep stay protected.</p></article><article><span>03 / START</span><h2>See it in your day.</h2><p>One work session, right in the calendar you already use.</p></article></section>
      </> : <>
        <section className="dashboard-heading"><div><p className="eyebrow">A LITTLE ROOM FOR PROGRESS</p><h1>Make time.<br /><em>Then make a start.</em></h1><p className="muted">Connected as {user.email}</p></div><div className="account-actions"><button className="button secondary" disabled={working} onClick={openSettings}>{showSettings ? "Close settings" : "Calendar & hours"}</button><a className="text-link" href="/api/auth/google">Reconnect Google</a><button className="text-link" disabled={working} onClick={() => act(async () => { await api("/api/auth/logout", {}); window.location.href = "/"; })}>Sign out</button></div></section>
        <div className="timezone-bar"><span className="small-dot" /><span>All times in <strong>{user.timezone}</strong></span><span>{user.workStart}–{user.workEnd} working hours</span><span>{user.sleepStart}–{user.sleepEnd} protected sleep</span></div>
        {showSettings && settings && <section className="panel settings"><p className="eyebrow">YOUR SCHEDULING BOUNDARIES</p><h2>Keep the important hours yours.</h2><form onSubmit={event => { event.preventDefault(); act(async () => { const data = await api("/api/settings", settings); setUser(data.user); setShowSettings(false); setMessage("Settings saved. They apply to new tasks; existing events keep their times."); }); }}>
          <div className="settings-grid"><label>Timezone<input required value={settings.timezone} placeholder="America/New_York" onChange={e => setSettings({ ...settings, timezone: e.target.value })} /><small>Use an IANA name, e.g. America/New_York or Asia/Kolkata.</small></label>{([['workStart', 'Work starts'], ['workEnd', 'Work ends'], ['sleepStart', 'Sleep starts'], ['sleepEnd', 'Sleep ends']] as const).map(([key, label]) => <label key={key}>{label}<input type="time" required value={settings[key]} onChange={e => setSettings({ ...settings, [key]: e.target.value })} /></label>)}</div>
          <fieldset><legend>Check these calendars for busy time</legend><p className="muted">Unselected calendars will not block scheduling. Right Now is always checked.</p>{choices?.filter(c => c.id !== user.rightNowCalendarId).map(c => <label className="checkbox" key={c.id}><input type="checkbox" checked={settings.selectedCalendarIds.includes(c.id) || (!!c.primary && settings.selectedCalendarIds.includes("primary"))} onChange={e => { const ids = settings.selectedCalendarIds.filter(id => id !== c.id && !(c.primary && id === "primary")); setSettings({ ...settings, selectedCalendarIds: e.target.checked ? [...ids, c.id] : ids }); }} />{c.summary}{c.primary ? " (primary)" : ""}</label>)}</fieldset>
          <button className="button primary" disabled={working}>Save settings</button>
        </form><div className="disconnect"><p className="muted">Disconnect removes saved Google access and signs you out. Your tasks and existing calendar events remain.</p><button className="text-link" disabled={working} onClick={() => act(async () => { const data = await api("/api/auth/disconnect", {}); setUser(null); setTasks([]); setMessage(data.warning || "Google access removed. Your existing events remain in Google Calendar."); })}>Disconnect Google Calendar</button></div></section>}
        <div className="workspace-grid">
          <section className="panel capture"><div className="section-label"><span>01 / YOUR NEXT STEP</span><span aria-hidden="true">↗</span></div><h2>What needs your time?</h2><p className="muted">One task. One continuous work session.</p>
            <form onSubmit={e => { e.preventDefault(); act(async () => { const pending = retry || restorePending(user.id); if (pending) { setRetry(pending); throw new Error("A previous submission needs a status check. Use ‘Check previous submission’ before starting another."); } await schedule({ requestId: crypto.randomUUID(), title, durationMinutes: Number(duration), deadlineLocal: deadline }); }); }}>
              <label>Task title<input name="title" placeholder="e.g. Finish the finance problem set" maxLength={200} required value={title} onChange={e => setTitle(e.target.value)} /></label>
              <label>Time you need <span className="label-hint">minutes</span><input name="duration" type="number" min={5} max={720} step={1} required value={duration} onChange={e => setDuration(e.target.value)} /></label>
              <label>Finish by <span className="label-hint">{user.timezone}</span><input name="deadline" type="datetime-local" required value={deadline} onChange={e => setDeadline(e.target.value)} /></label>
              <p className="fine-print">Choose a deadline within 90 days. If the full task cannot fit, we’ll save it with an explanation.</p>
              <button className="button primary full" disabled={working}>{working ? "Checking your calendar…" : "Find a time & schedule"}<span aria-hidden="true">↗</span></button>
            </form>
            <button className="text-link retry" disabled={working} onClick={() => act(async () => { const pending = retry || restorePending(user.id); if (!pending) { setMessage("No interrupted submission is saved in this tab."); return; } await schedule(pending); })}>Check previous submission</button>
          </section>
          <section className="task-section"><div className="task-heading"><div><p className="eyebrow">02 / ON YOUR RADAR</p><h2>Your tasks <span className="count">{tasks.length}</span></h2></div><button className="text-link" disabled={working} onClick={() => act(async () => { setTasks((await api("/api/tasks")).tasks); setMessage("Saved tasks refreshed. Calendar changes are not synchronized in Milestone 1."); })}>Refresh list ↻</button></div><p className="muted">{scheduled} scheduled · {tasks.length - scheduled} awaiting a work session</p>
            {tasks.length === 0 ? <div className="empty-state"><span className="empty-icon" aria-hidden="true">↗</span><h3>A little space to get started.</h3><p>Add your first task. We’ll find a realistic place for it in your day.</p></div> : <ul className="task-list">{tasks.map(task => <li className="task-card" key={task.id}><div className="task-card-top"><span className={`status ${task.status}`}>{task.status === "error" ? "Needs a status check" : task.status === "unscheduled" ? "No slot available" : task.status}</span><span className="duration">{task.durationMinutes} MIN</span></div><h3>{task.title}</h3><p className="task-time">{task.startAt ? displayTime(task.startAt, user.timezone) : "Work session not allocated"}{task.endAt && <> → {new Intl.DateTimeFormat("en-US", { timeZone: user.timezone, hour: "numeric", minute: "2-digit" }).format(new Date(task.endAt))}</>}</p><p className="muted">Due {displayTime(task.dueAt, user.timezone)}</p><details><summary>Why this result?</summary><p>{task.rationale}</p></details>{task.status === "error" && <button className="text-link retry" disabled={working} onClick={() => act(() => schedule({ requestId: task.requestId, title: task.title, durationMinutes: task.durationMinutes, deadlineLocal: task.deadlineLocal })))}>Check this task’s status</button>}{task.eventId && <a className="text-link calendar-link" href={`https://calendar.google.com/calendar/u/0/r?cid=${encodeURIComponent(task.calendarId!)}`} target="_blank" rel="noreferrer">Open calendar ↗</a>}</li>)}</ul>}
            <p className="fine-print sync-note">This pilot shows saved scheduling results. View live event changes in Google Calendar.</p>
          </section>
        </div>
      </>}
    </main><footer><span className="footer-brand">right now.</span><span>A realistic place to begin.</span><span>Milestone 1 · Calendar only</span></footer>
  </div>;
}
