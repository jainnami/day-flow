import { currentUserId } from "@/server/auth/session";
import { getUser, listTasks } from "@/server/db/repository";
import { setupReady } from "@/server/config";
import { Dashboard } from "@/components/dashboard";
export const dynamic = "force-dynamic";
const authMessages: Record<string, string> = {
  denied: "Google permission was declined. Connect again when you are ready.",
  state: "That sign-in link expired or could not be verified. Start a new connection.",
  permissions: "Google did not grant all required Calendar permissions. Reconnect and select all requested permissions.",
  failed: "Google connection could not finish. Check your Google credentials, database migration, and Calendar permissions, then reconnect.",
  setup: "Complete the environment and database setup in README.md before connecting Google.",
  connected: "Google Calendar connected. Review your timezone and scheduling hours before adding a task.",
};
export default async function Home({ searchParams }: { searchParams: Promise<{ auth?: string }> }) {
  const ready = setupReady(), params = await searchParams;
  let user = null, tasks: Awaited<ReturnType<typeof listTasks>> = [], loadError = "";
  if (ready) {
    try { const id = await currentUserId(); if (id) { user = await getUser(id); if (user) tasks = await listTasks(id); } }
    catch { loadError = "Your saved account could not be loaded. Check the PostgreSQL connection and run the database migration."; }
  }
  return <Dashboard initialUser={user} initialTasks={tasks} ready={ready} initialMessage={loadError || authMessages[params.auth ?? ""] || ""} />;
}
