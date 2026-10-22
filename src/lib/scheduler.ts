import { Temporal } from "@js-temporal/polyfill";
import type { Interval, Settings } from "./types";
const minute = 60_000;
export const MAX_HORIZON_DAYS = 90;
export function overlaps(a: Interval, b: Interval): boolean {
  return Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);
}
export function earliestSlot(input: {
  now: string; dueAt: string; durationMinutes: number; settings: Settings; busy: Interval[];
}): Interval | null {
  const { settings, durationMinutes } = input;
  const now = Date.parse(input.now), due = Date.parse(input.dueAt);
  if (!Number.isFinite(now) || !Number.isFinite(due) || durationMinutes <= 0 || due <= now) return null;
  const today = Temporal.Instant.from(input.now).toZonedDateTimeISO(settings.timezone).toPlainDate();
  const at = (date: Temporal.PlainDate, time: string) => date.toPlainDateTime(time).toZonedDateTime(settings.timezone).epochMilliseconds;
  const blocked = input.busy.map(i => ({ start: Date.parse(i.start), end: Date.parse(i.end) }));
  if (blocked.some(i => !Number.isFinite(i.start) || !Number.isFinite(i.end) || i.end < i.start)) throw new Error("Invalid busy interval.");
  // Include the preceding night so overnight sleep blocks the first morning too.
  for (let day = -1; day <= MAX_HORIZON_DAYS; day++) {
    const date = today.add({ days: day });
    blocked.push({ start: at(date, settings.sleepStart), end: at(date.add({ days: settings.sleepStart > settings.sleepEnd ? 1 : 0 }), settings.sleepEnd) });
  }
  blocked.sort((a, b) => a.start - b.start);
  for (let day = 0; day <= MAX_HORIZON_DAYS; day++) {
    const date = today.add({ days: day });
    let cursor = Math.max(Math.ceil(now / minute) * minute, at(date, settings.workStart));
    const end = Math.min(due, at(date, settings.workEnd));
    if (cursor >= due) break;
    for (const b of blocked) {
      if (b.end <= cursor) continue;
      if (b.start >= end) break;
      if (cursor + durationMinutes * minute <= Math.min(b.start, end)) return { start: new Date(cursor).toISOString(), end: new Date(cursor + durationMinutes * minute).toISOString() };
      cursor = Math.max(cursor, b.end);
    }
    if (cursor + durationMinutes * minute <= end) return { start: new Date(cursor).toISOString(), end: new Date(cursor + durationMinutes * minute).toISOString() };
  }
  return null;
}
