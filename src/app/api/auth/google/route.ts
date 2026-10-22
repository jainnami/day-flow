import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { oauthClient, SCOPES } from "@/server/auth/google";
import { randomToken } from "@/server/auth/crypto";
import { cookieOptions } from "@/server/auth/session";
import { appUrl } from "@/server/config";
import { failure } from "@/server/http";
import { CodeChallengeMethod } from "google-auth-library";
export const runtime = "nodejs";
export async function GET() {
  try {
    const client = oauthClient(), state = randomToken();
    const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
    const jar = await cookies();
    jar.set("rn_oauth", JSON.stringify({ state, codeVerifier }), { ...cookieOptions(), maxAge: 600 });
    return NextResponse.redirect(client.generateAuthUrl({ access_type: "offline", prompt: "consent", include_granted_scopes: true, scope: SCOPES, state, code_challenge: codeChallenge, code_challenge_method: CodeChallengeMethod.S256 }));
  } catch (error) { try { return NextResponse.redirect(`${appUrl()}/?auth=setup`); } catch { return failure(error); } }
}
