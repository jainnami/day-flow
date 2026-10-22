import { describe, expect, it } from "vitest";
import { googleTaskDate } from "../src/lib/google-task-date";

describe("next local day for Google Tasks", () => {
  it.each([
    ["2026-10-24T01:00:00Z", "America/New_York", "2026-10-24"],
    ["2026-10-23T20:00:00Z", "Asia/Kolkata", "2026-10-25"],
    ["2026-11-01T00:30:00Z", "America/New_York", "2026-11-01"],
    ["2026-03-08T04:30:00Z", "America/New_York", "2026-03-08"],
    ["2026-12-31T18:00:00Z", "America/New_York", "2027-01-01"],
    ["2028-02-28T12:00:00Z", "UTC", "2028-02-29"],
  ])("uses the calendar day after %s in %s", (start, timezone, day) => {
    expect(googleTaskDate(start, timezone)).toBe(`${day}T00:00:00.000Z`);
  });
});
