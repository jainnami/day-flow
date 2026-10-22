import { NextResponse } from "next/server";
import { taskSchema } from "@/lib/validation";
import { requireUser } from "@/server/auth/session";
import { listTasks } from "@/server/db/repository";
import { submitTask } from "@/server/services/task-workflow";
import { failure, jsonBody, requireOrigin } from "@/server/http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET() {
  try { return NextResponse.json({ tasks: await listTasks(await requireUser()) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    requireOrigin(request);
    const userId = await requireUser(), input = taskSchema.parse(await jsonBody(request));
    const task = await submitTask(userId, input);
    return NextResponse.json({ task }, { status: task.status === "error" || task.syncError ? 502 : 200 });
  } catch (error) { return failure(error); }
}
