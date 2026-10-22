import "server-only";
import { OAuth2Client } from "google-auth-library";
import { appUrl, required } from "../config";
export const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.calendarlist.readonly", "https://www.googleapis.com/auth/calendar.events.freebusy", "https://www.googleapis.com/auth/calendar.app.created"];
export function oauthClient() {
  return new OAuth2Client(required("GOOGLE_CLIENT_ID"), required("GOOGLE_CLIENT_SECRET"), `${appUrl()}/api/auth/google/callback`);
}
