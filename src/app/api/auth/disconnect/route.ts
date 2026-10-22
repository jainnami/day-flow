import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireUser, SESSION_COOKIE } from "@/server/auth/session";
import { decrypt } from "@/server/auth/crypto";
import { oauthClient } from "@/server/auth/google";
import { userTransaction } from "@/server/db/pool";
import { failure, requireOrigin } from "@/server/http";
export async function POST(request: Request) {
  try {
    requireOrigin(request);
    const userId = await requireUser();
    let revoked = true;
    await userTransaction(userId, async db => {
      const r = await db.query("SELECT encrypted_refresh_token FROM oauth_connections WHERE user_id=$1", [userId]);
      if (r.rows[0]) {
        try { await oauthClient().revokeToken(decrypt(r.rows[0].encrypted_refresh_token)); }
        catch { revoked = false; }
      }
      await db.query("DELETE FROM oauth_connections WHERE user_id=$1", [userId]);
      await db.query("DELETE FROM app_sessions WHERE user_id=$1", [userId]);
    });
    (await cookies()).delete(SESSION_COOKIE);
    return NextResponse.json({ ok: true, warning: revoked ? null : "Local access was removed. Google revocation could not be confirmed. Remove Right Now under your Google Account's third-party connections." });
  } catch (error) { return failure(error); }
}
