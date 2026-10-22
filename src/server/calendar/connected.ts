import "server-only";
import { decrypt } from "../auth/crypto";
import { oauthClient, TASKS_SCOPE } from "../auth/google";
import { pool } from "../db/pool";
import { AppError } from "../errors";
import { CalendarAdapter } from "./adapter";
export async function connectedCalendar(userId: string, requireTasks = false) {
  const result = await pool().query("SELECT encrypted_refresh_token,status,scopes FROM oauth_connections WHERE user_id=$1", [userId]);
  const row = result.rows[0];
  if (!row || row.status !== "connected") throw new AppError("Reconnect Google Calendar to continue.", 401);
  if (requireTasks && !row.scopes.includes(TASKS_SCOPE)) throw new AppError("Reconnect Google to grant the new Google Tasks permission before linking or syncing tasks.", 401);
  const client = oauthClient();
  client.setCredentials({ refresh_token: decrypt(row.encrypted_refresh_token) });
  try { await client.getAccessToken(); }
  catch (error) {
    const code = (error as { response?: { data?: { error?: string } } }).response?.data?.error;
    if (code === "invalid_grant") {
      await pool().query("UPDATE oauth_connections SET status='reconnect_required',updated_at=now() WHERE user_id=$1", [userId]);
      throw new AppError("Google access was revoked or expired. Reconnect Google Calendar.", 401);
    }
    throw new AppError("Google could not be reached. Try again shortly.", 502);
  }
  return { adapter: new CalendarAdapter(client), client };
}
