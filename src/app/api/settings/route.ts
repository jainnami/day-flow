import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { connectedCalendar } from "@/server/calendar/connected";
import { getUser, saveSettings } from "@/server/db/repository";
import { userTransaction } from "@/server/db/pool";
import { settingsSchema } from "@/lib/validation";
import { failure, jsonBody, requireOrigin } from "@/server/http";
import { AppError } from "@/server/errors";
export async function POST(request: Request) {
  try {
    requireOrigin(request);
    const userId = await requireUser(), settings = settingsSchema.parse(await jsonBody(request));
    const { adapter } = await connectedCalendar(userId);
    const allowed = new Set((await adapter.listCalendars()).map(c => c.id));
    allowed.add("primary");
    if (settings.selectedCalendarIds.some(id => !allowed.has(id))) throw new AppError("Choose calendars from your connected account.");
    const user = await userTransaction(userId, async db => { await saveSettings(db, userId, settings); return getUser(userId, db); });
    return NextResponse.json({ user });
  } catch (error) { return failure(error); }
}
