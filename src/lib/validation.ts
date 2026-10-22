import { z } from "zod";
import { Temporal } from "@js-temporal/polyfill";
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const settingsSchema = z.object({
  timezone: z.string().refine(v => { try { Temporal.Now.zonedDateTimeISO(v); return true; } catch { return false; } }, "Choose a valid timezone."),
  workStart: time, workEnd: time, sleepStart: time, sleepEnd: time,
  selectedCalendarIds: z.array(z.string().min(1).max(1024)).min(1).max(49),
}).refine(v => v.workStart < v.workEnd, "Working hours must start and end on the same day, in that order.")
  .refine(v => v.sleepStart !== v.sleepEnd, "Sleep start and end must differ.");
export const taskSchema = z.object({
  requestId: z.uuid(), title: z.string().trim().min(1).max(200),
  durationMinutes: z.number().int().min(5).max(720),
  deadlineLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
});
export function deadlineToUtc(local: string, timezone: string): string {
  try { return Temporal.PlainDateTime.from(local).toZonedDateTime(timezone, { disambiguation: "reject" }).toInstant().toString(); }
  catch { throw new Error("That deadline is invalid or ambiguous because of a daylight-saving clock change. Choose another time."); }
}
