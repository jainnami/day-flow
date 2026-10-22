import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../src/app/api/auth/google/callback/route";
import { SCOPES } from "../src/server/auth/google";
import { GoogleTasksError } from "../src/server/tasks/adapter";
import { AppError } from "../src/server/errors";
const state = vi.hoisted(() => ({
  committed: false, cookieSetAfterCommit: false,
  getToken: vi.fn(), verifyIdToken: vi.fn(), ensureCalendar: vi.fn(), ensureList: vi.fn(),
  query: vi.fn(), cookieSet: vi.fn(), cookieDelete: vi.fn(), log: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => name === "rn_oauth" ? { value: JSON.stringify({ state: "valid-state", codeVerifier: "verifier" }) } : { value: "existing-session" },
  delete: state.cookieDelete,
  set: (...args: unknown[]) => { state.cookieSetAfterCommit = state.committed; state.cookieSet(...args); },
}) }));
vi.mock("../src/server/auth/google", async importOriginal => ({ ...await importOriginal<object>(), oauthClient: () => ({ getToken: state.getToken, verifyIdToken: state.verifyIdToken, setCredentials: vi.fn() }) }));
vi.mock("../src/server/db/pool", () => ({
  pool: () => ({ query: state.query }),
  userTransaction: async (_id: string, run: (db: { query: typeof state.query }) => Promise<void>) => { await run({ query: state.query }); state.committed = true; },
}));
vi.mock("../src/server/db/repository", () => ({ getUser: async () => ({ id: "user-1", timezone: "America/New_York", rightNowCalendarId: "calendar-1", rightNowTaskListId: null }) }));
vi.mock("../src/server/calendar/adapter", () => ({ CalendarAdapter: class { ensureCalendar = state.ensureCalendar; } }));
vi.mock("../src/server/tasks/adapter", async importOriginal => ({ ...await importOriginal<object>(), TasksAdapter: class { ensureList = state.ensureList; } }));
beforeEach(() => {
  vi.clearAllMocks(); state.committed = false; state.cookieSetAfterCommit = false;
  vi.stubEnv("APP_URL", "http://localhost:3000"); vi.stubEnv("GOOGLE_CLIENT_ID", "test-client");
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
  state.getToken.mockResolvedValue({ tokens: { id_token: "private-id-token", refresh_token: "private-refresh-token", scope: SCOPES.join(" ") } });
  state.verifyIdToken.mockResolvedValue({ getPayload: () => ({ sub: "google-user", email: "test@example.com", email_verified: true }) });
  state.query.mockResolvedValue({ rows: [{ id: "user-1" }] });
  state.ensureCalendar.mockResolvedValue("calendar-1"); state.ensureList.mockResolvedValue("list-1");
  vi.spyOn(console, "error").mockImplementation(state.log);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const connect = () => GET(new Request("http://localhost:3000/api/auth/google/callback?state=valid-state&code=one-use-code"));
describe("OAuth callback failure and session behavior", () => {
  it("reports disabled Tasks API and preserves an existing session on reconnect failure", async () => {
    state.ensureList.mockRejectedValue(new GoogleTasksError("disabled", 403, "tasks_api_disabled"));
    const response = await connect();
    expect(response.headers.get("location")).toBe("http://localhost:3000/?auth=tasks_api_disabled");
    expect(state.committed).toBe(false); expect(state.cookieSet).not.toHaveBeenCalled();
    expect(state.cookieDelete).not.toHaveBeenCalledWith("rn_session");
    expect(state.log).toHaveBeenCalledWith("Google connection failed: stage=tasks reason=tasks_api_disabled");
  });
  it("reports insufficient Tasks permission distinctly", async () => {
    state.ensureList.mockRejectedValue(new GoogleTasksError("insufficient permission", 403, "tasks_permissions"));
    expect((await connect()).headers.get("location")).toContain("auth=tasks_permissions");
  });
  it("reports migration problems before trying Google resource setup", async () => {
    state.query.mockRejectedValueOnce({ code: "42703", message: "sensitive database diagnostics" });
    expect((await connect()).headers.get("location")).toContain("auth=database_migration");
    expect(state.ensureCalendar).not.toHaveBeenCalled();
  });
  it("reports a missing dedicated Calendar without creating a task list", async () => {
    state.ensureCalendar.mockRejectedValue(new AppError("missing", 409));
    expect((await connect()).headers.get("location")).toContain("auth=calendar_missing");
    expect(state.ensureList).not.toHaveBeenCalled();
  });
  it("sets the new session cookie only after the database transaction commits", async () => {
    expect((await connect()).headers.get("location")).toBe("http://localhost:3000/?auth=connected");
    expect(state.committed).toBe(true); expect(state.cookieSetAfterCommit).toBe(true);
    expect(state.cookieSet.mock.calls[0][0]).toBe("rn_session");
  });
});
