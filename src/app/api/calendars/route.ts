import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { connectedCalendar } from "@/server/calendar/connected";
import { failure } from "@/server/http";
export async function GET() {
  try {
    const { adapter } = await connectedCalendar(await requireUser());
    const calendars = (await adapter.listCalendars()).map(({ id, summary, primary }) => ({ id, summary, primary }));
    return NextResponse.json({ calendars }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
