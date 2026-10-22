import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { hashToken } from "@/server/auth/crypto";
import { SESSION_COOKIE } from "@/server/auth/session";
import { pool } from "@/server/db/pool";
import { failure, requireOrigin } from "@/server/http";
export async function POST(request: Request) {
  try {
    requireOrigin(request);
    const jar = await cookies(), token = jar.get(SESSION_COOKIE)?.value;
    if (token) await pool().query("DELETE FROM app_sessions WHERE token_hash=$1", [hashToken(token)]);
    jar.delete(SESSION_COOKIE);
    return NextResponse.json({ ok: true });
  } catch (error) { return failure(error); }
}
