import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { oauthClient, SCOPES } from "@/server/auth/google";
import { encrypt, hashToken, randomToken } from "@/server/auth/crypto";
import { cookieOptions, SESSION_COOKIE } from "@/server/auth/session";
import { appUrl, required } from "@/server/config";
import { pool, userTransaction } from "@/server/db/pool";
import { getUser } from "@/server/db/repository";
import { CalendarAdapter } from "@/server/calendar/adapter";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const jar = await cookies();
  const redirect = (status: string) => NextResponse.redirect(`${appUrl()}/?auth=${status}`);
  try {
    const params = new URL(request.url).searchParams;
    const saved = JSON.parse(jar.get("rn_oauth")?.value ?? "null");
    jar.delete("rn_oauth");
    const state = params.get("state") ?? "";
    if (!saved?.state || Buffer.byteLength(state) !== Buffer.byteLength(saved.state) || !timingSafeEqual(Buffer.from(state), Buffer.from(saved.state))) return redirect("state");
    if (params.has("error")) return redirect("denied");
    const code = params.get("code");
    if (!code) return redirect("failed");
    const client = oauthClient();
    const { tokens } = await client.getToken({ code, codeVerifier: saved.codeVerifier });
    if (!tokens.id_token || !tokens.refresh_token) return redirect("permissions");
    const scopes = tokens.scope?.split(" ") ?? [];
    if (SCOPES.filter(s => s.includes("calendar.")).some(s => !scopes.includes(s))) return redirect("permissions");
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: required("GOOGLE_CLIENT_ID") });
    const identity = ticket.getPayload();
    if (!identity?.sub || !identity.email || !identity.email_verified) return redirect("failed");
    const result = await pool().query("INSERT INTO users(id,google_sub,email) VALUES($1,$2,$3) ON CONFLICT(google_sub) DO UPDATE SET email=EXCLUDED.email RETURNING id", [randomUUID(), identity.sub, identity.email]);
    const userId = result.rows[0].id;
    const encrypted = encrypt(tokens.refresh_token);
    await userTransaction(userId, async db => {
      await db.query("INSERT INTO oauth_connections(user_id,encrypted_refresh_token,scopes) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET encrypted_refresh_token=EXCLUDED.encrypted_refresh_token,scopes=EXCLUDED.scopes,status='connected',updated_at=now()", [userId, encrypted, scopes]);
      const user = (await getUser(userId, db))!;
      client.setCredentials(tokens);
      const calendarId = await new CalendarAdapter(client).ensureCalendar(user.rightNowCalendarId, `Right Now Milestone 1 calendar ${hashToken(required("GOOGLE_CLIENT_ID") + userId)}`, user.timezone);
      await db.query("UPDATE users SET right_now_calendar_id=$2 WHERE id=$1", [userId, calendarId]);
      const session = randomToken();
      await db.query("DELETE FROM app_sessions WHERE user_id=$1 AND expires_at <= now()", [userId]);
      await db.query("INSERT INTO app_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')", [hashToken(session), userId]);
      jar.set(SESSION_COOKIE, session, { ...cookieOptions(), maxAge: 7 * 86400 });
    });
    return redirect("connected");
  } catch { jar.delete(SESSION_COOKIE); return redirect("failed"); }
}
