import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { connectedCalendar } from "@/server/calendar/connected";
import { getUser, listSyncPage } from "@/server/db/repository";
import { syncExistingTask } from "@/server/services/task-workflow";
import { TasksAdapter } from "@/server/tasks/adapter";
import { AppError, publicError } from "@/server/errors";
import { failure, jsonBody, requireOrigin } from "@/server/http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    requireOrigin(request);
    const userId = await requireUser();
    const { cursor } = z.object({ cursor: z.uuid().nullable().optional() }).parse(await jsonBody(request));
    const { adapter, client } = await connectedCalendar(userId, true), user = await getUser(userId);
    if (!user?.rightNowTaskListId) throw new AppError("Reconnect Google to create your Right Now task list.", 409);
    const page = await listSyncPage(userId, cursor ?? null), google = new TasksAdapter(client);
    const results = [];
    for (const task of page.tasks) {
      try {
        const updated = await syncExistingTask(userId, task.requestId, user.rightNowTaskListId, google, adapter, user.timezone);
        results.push({ id: updated.id, error: updated.syncError ?? null });
      } catch (error) { results.push({ id: task.id, error: publicError(error).message }); }
    }
    return NextResponse.json({ results, nextCursor: page.nextCursor }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
