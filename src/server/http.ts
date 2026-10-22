import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { appUrl } from "./config";
import { AppError, publicError } from "./errors";
export function requireOrigin(request: Request) {
  if (request.headers.get("origin") !== appUrl()) throw new AppError("This request did not come from Right Now. Reload the app and retry.", 403);
}
export async function jsonBody(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new AppError("Send a JSON request.", 415);
  const body = await request.text();
  if (body.length > 16_384) throw new AppError("Request is too large.", 413);
  try { return JSON.parse(body); } catch { throw new AppError("Invalid JSON."); }
}
export function failure(error: unknown) {
  if (error instanceof ZodError) return NextResponse.json({ error: error.issues.map(i => i.message).join(" ") }, { status: 400 });
  const { message, status } = publicError(error);
  return NextResponse.json({ error: message }, { status });
}
