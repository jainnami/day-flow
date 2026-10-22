import { afterEach, describe, expect, it, vi } from "vitest";
import { decrypt, encrypt, hashToken } from "../src/server/auth/crypto";
import { requireOrigin } from "../src/server/http";
import { publicError } from "../src/server/errors";
import { SCOPES } from "../src/server/auth/google";
afterEach(() => vi.unstubAllEnvs());
describe("Milestone 1 security boundaries", () => {
  it("encrypts refresh tokens with random nonces and detects tampering", () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    const first = encrypt("refresh-secret"), second = encrypt("refresh-secret");
    expect(first).not.toBe(second); expect(first).not.toContain("refresh-secret"); expect(decrypt(first)).toBe("refresh-secret");
    const pieces = first.split("."); pieces[2] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(pieces.join("."))).toThrow();
  });
  it("refuses malformed encryption keys", () => { vi.stubEnv("TOKEN_ENCRYPTION_KEY", "short"); expect(() => encrypt("secret")).toThrow("32 random bytes"); });
  it("hashes session tokens for storage", () => { expect(hashToken("secret")).toHaveLength(64); expect(hashToken("secret")).not.toContain("secret"); });
  it("rejects missing and foreign origins on mutations", () => {
    vi.stubEnv("APP_URL", "http://localhost:3000");
    expect(() => requireOrigin(new Request("http://localhost:3000/api/tasks"))).toThrow();
    expect(() => requireOrigin(new Request("http://localhost:3000/api/tasks", { headers: { origin: "https://attacker.example" } }))).toThrow();
    expect(() => requireOrigin(new Request("http://localhost:3000/api/tasks", { headers: { origin: "http://localhost:3000" } }))).not.toThrow();
  });
  it("does not return raw internal errors", () => expect(publicError(new Error("postgresql://password@host/db"))).toEqual({ status: 500, message: expect.not.stringContaining("password") }));
  it("requests Tasks write access and narrow Calendar scopes", () => { expect(SCOPES).toContain("https://www.googleapis.com/auth/tasks"); expect(SCOPES).not.toContain("https://www.googleapis.com/auth/calendar"); });
});
