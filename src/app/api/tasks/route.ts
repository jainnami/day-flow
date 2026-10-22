import { NextResponse } from "next/server";
import { taskSchema } from "@/lib/validation";
import { requireUser } from "@/server/auth/session";
import { connectedCalendar } from "@/server/calendar/connected";
import { userTransaction } from "@/server/db/pool";
import { getUser, listTasks, taskRepository } from "@/server/db/repository";
import { scheduleTask } from "@/server/services/schedule-task";
import { failure, jsonBody, requireOrigin } from "@/server/http";
import { AppError } from "@/server/errors";
export const runtime = "nodejs";
export async function GET() {
  try { return NextResponse.json({ tasks: await listTasks(await requireUser()) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    requireOrigin(request);
    const userId = await requireUser(), input = taskSchema.parse(await jsonBody(request));
    const { adapter } = await connectedCalendar(userId);
    const task = await userTransaction(userId, async db => {
      const connection = await db.query("SELECT status FROM oauth_connections WHERE user_id=$1", [userId]);
      if (connection.rows[0]?.status !== "connected") throw new AppError("Reconnect Google Calendar to continue.", 401);
      const user = (await getUser(userId, db))!;
      return scheduleTask(input, user, taskRepository(db, userId), adapter);
    });
    return NextResponse.json({ task }, { status: task.status === "error" ? 502 : 200 });
  } catch (error) { return failure(error); }
}
