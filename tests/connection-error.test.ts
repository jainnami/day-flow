import { describe, expect, it, vi } from "vitest";
import { connectionFailure, logConnectionFailure } from "../src/server/auth/connection-error";
import { GoogleTasksError } from "../src/server/tasks/adapter";
import { AppError } from "../src/server/errors";
describe("Safe Google connection diagnostics", () => {
  it("distinguishes disabled Tasks API and insufficient permission", () => {
    expect(connectionFailure("tasks", new GoogleTasksError("not enabled", 403, "tasks_api_disabled"))).toBe("tasks_api_disabled");
    expect(connectionFailure("tasks", new GoogleTasksError("missing scope", 403, "tasks_permissions"))).toBe("tasks_permissions");
  });
  it("distinguishes schema failures from database connectivity", () => {
    expect(connectionFailure("database", { code: "42703" })).toBe("database_migration");
    expect(connectionFailure("database", { code: "ETIMEDOUT" })).toBe("database_connection");
  });
  it("handles missing app resources separately", () => {
    expect(connectionFailure("tasks", new AppError("missing", 409))).toBe("tasks_list_missing");
    expect(connectionFailure("calendar", new AppError("missing", 409))).toBe("calendar_missing");
  });
  it("identifies rejected client credentials without forwarding Google's response", () => {
    expect(connectionFailure("oauth", { response: { data: { error: "invalid_client", client_secret: "private-secret" } } })).toBe("oauth_client");
    expect(connectionFailure("oauth", new Error("token-secret"))).toBe("oauth_exchange");
  });
  it("logs only stage and a controlled reason code", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try { logConnectionFailure("tasks", "tasks_permissions"); expect(spy).toHaveBeenCalledWith("Google connection failed: stage=tasks reason=tasks_permissions"); }
    finally { spy.mockRestore(); }
  });
});
