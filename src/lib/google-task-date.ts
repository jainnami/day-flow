import { Temporal } from "@js-temporal/polyfill";

// Google Tasks stores a calendar date encoded as UTC midnight, not an instant
// in the user's timezone. Add one local calendar day, including across DST.
export function googleTaskDate(eventStart: string, timezone: string): string {
  const day = Temporal.Instant.from(eventStart).toZonedDateTimeISO(timezone).toPlainDate().add({ days: 1 });
  return `${day}T00:00:00.000Z`;
}
