import { currentUserId } from "@/server/auth/session";
import { getUser, listTasks } from "@/server/db/repository";
import { setupReady } from "@/server/config";
import { Dashboard } from "@/components/dashboard";
import { TASKS_SCOPE } from "@/server/auth/google";
import { pool } from "@/server/db/pool";
export const dynamic = "force-dynamic";
const authMessages: Record<string, string> = {
  denied: "Google permission was declined. Connect again when you are ready.",
  state: "That sign-in link expired or could not be verified. Start a new connection.",
  permissions: "Google did not grant all required Calendar and Tasks permissions. Reconnect and select all requested permissions.",
  failed: "Google connection could not finish. Check the database migration, enable Calendar API and Tasks API, and approve all requested permissions, then reconnect.",
  tasks_api_disabled: "Google Tasks API is disabled in your Google Cloud project. Enable Google Tasks API, wait briefly, then reconnect Google.",
  tasks_permissions: "Google did not authorize Tasks access. Reconnect Google and approve the permission to create and manage your tasks.",
  tasks_connection_failed: "Google sign-in reached the Tasks setup step, but it could not finish. Verify Google Tasks API is enabled and your account permits Tasks access, then reconnect.",
  tasks_list_missing: "Your saved Right Now task list is missing in Google Tasks. It will not be recreated automatically. Review the deleted list and existing task links.",
  calendar_missing: "Your saved Right Now calendar is missing. Restore it in Google Calendar, then reconnect.",
  calendar_connection_failed: "Google sign-in reached the Calendar setup step, but Calendar access failed. Check Calendar API and account permissions, then reconnect.",
  database_migration: "The database schema is missing required fields. Run npm.cmd run db:migrate against this instance's Neon database, then reconnect.",
  database_connection: "Google sign-in succeeded, but the app could not finish saving the connection. Check this instance's database settings and encryption key, then reconnect.",
  oauth_client: "Google rejected this app's OAuth credentials. Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET for this instance, then restart or redeploy.",
  oauth_exchange: "Google could not exchange the sign-in code. Start a fresh connection and check that APP_URL matches the authorized callback URL.",
  google_identity: "Google identity verification could not finish. Start a fresh connection using a verified Google account.",
  setup: "Complete the environment and database setup in README.md before connecting Google.",
  connected: "Google Calendar and Tasks connected. Review your timezone and scheduling hours before adding a task.",
};
export default async function Home({ searchParams }: { searchParams: Promise<{ auth?: string }> }) {
  const ready = setupReady(), params = await searchParams;
  let user = null, tasks: Awaited<ReturnType<typeof listTasks>> = [], loadError = "", tasksConnected = false;
  if (ready) {
    try { const id = await currentUserId(); if (id) { user = await getUser(id); if (user) {
      tasks = await listTasks(id);
      const connection = await pool().query("SELECT scopes,status FROM oauth_connections WHERE user_id=$1", [id]);
      tasksConnected = connection.rows[0]?.status === "connected" && connection.rows[0]?.scopes.includes(TASKS_SCOPE) && !!user.rightNowTaskListId;
    } } }
    catch { loadError = "Your saved account could not be loaded. Check the PostgreSQL connection and run the database migration."; }
  }
  return <Dashboard initialUser={user} initialTasks={tasks} ready={ready} tasksConnected={tasksConnected} initialMessage={loadError || authMessages[params.auth ?? ""] || ""} />;
}
