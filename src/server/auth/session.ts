import "server-only";
import { cookies } from "next/headers";
import { pool } from "../db/pool";
import { AppError } from "../errors";
import { hashToken } from "./crypto";
export const SESSION_COOKIE = "rn_session";
export const cookieOptions = () => ({ httpOnly: true, secure: process.env.APP_URL?.startsWith("https://") ?? false, sameSite: "lax" as const, path: "/" });
export async function currentUserId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const result = await pool().query("SELECT user_id FROM app_sessions WHERE token_hash=$1 AND expires_at > now()", [hashToken(token)]);
  return result.rows[0]?.user_id ?? null;
}
export async function requireUser() {
  const id = await currentUserId();
  if (!id) throw new AppError("Sign in with Google to continue.", 401);
  return id;
}
