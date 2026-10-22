import { AppError } from "../errors";
import { GoogleTasksError } from "../tasks/adapter";
export type ConnectionStage = "oauth" | "identity" | "database" | "calendar" | "tasks";
export function connectionFailure(stage: ConnectionStage, error: unknown): string {
  if (error instanceof GoogleTasksError) return error.connectionCode;
  if (stage === "tasks" && error instanceof AppError && error.status === 409) return "tasks_list_missing";
  if (stage === "calendar" && error instanceof AppError && error.status === 409) return "calendar_missing";
  const code = (error as { code?: string } | null)?.code;
  if (stage === "database") return ["42P01", "42703"].includes(code ?? "") ? "database_migration" : "database_connection";
  const oauth = (error as { response?: { data?: { error?: string } } } | null)?.response?.data?.error;
  if (stage === "oauth" && ["invalid_client", "unauthorized_client"].includes(oauth ?? "")) return "oauth_client";
  return ({ oauth: "oauth_exchange", identity: "google_identity", calendar: "calendar_connection_failed", tasks: "tasks_connection_failed" } as const)[stage];
}
export function logConnectionFailure(stage: ConnectionStage, reason: string) {
  // Never log the raw error: OAuth/library errors may contain tokens or credentials.
  console.error(`Google connection failed: stage=${stage} reason=${reason}`);
}
