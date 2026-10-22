import { describe, expect, it, vi } from "vitest";
import pg from "pg";
import { connectionStringForPg } from "../src/server/db/connection-string";
describe("PostgreSQL SSL configuration", () => {
  it.each(["require", "prefer", "verify-ca"])("makes the legacy %s alias explicitly verify-full without pg warnings", mode => {
    const warning = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    try {
      const value = connectionStringForPg(`postgresql://student:pass@db.example.test/right_now?sslmode=${mode}&channel_binding=require`);
      expect(new URL(value).searchParams.get("sslmode")).toBe("verify-full");
      expect(new URL(value).searchParams.get("channel_binding")).toBe("require");
      const client = new pg.Client({ connectionString: value });
      expect(client.ssl).not.toBe(false);
      expect((client.ssl as unknown as { rejectUnauthorized?: boolean }).rejectUnauthorized).not.toBe(false);
      expect(warning).not.toHaveBeenCalled();
    } finally { warning.mockRestore(); }
  });
  it("preserves escaped credentials and the database path", () => {
    const url = new URL(connectionStringForPg("postgresql://user:p%40ss%2Bword@db.example.test/my_database?sslmode=require"));
    expect(url.username).toBe("user"); expect(url.password).toBe("p%40ss%2Bword"); expect(url.pathname).toBe("/my_database");
  });
  it.each(["postgresql://student:pass@db.example.test/db?sslmode=verify-full", "postgresql://student:pass@localhost:5432/db", "postgresql://student:pass@localhost/db?sslmode=disable", "postgresql://student:pass@db.example.test/db?sslmode=require&uselibpqcompat=true"])("preserves explicit configuration: %s", value => expect(connectionStringForPg(value)).toBe(value));
  it("reports malformed URLs without exposing the supplied value", () => {
    expect(() => connectionStringForPg("secret-password")).toThrow("valid PostgreSQL connection URL");
    expect(() => connectionStringForPg("https://student:secret-password@db.example.test/db")).toThrow("must use postgres://");
  });
});
