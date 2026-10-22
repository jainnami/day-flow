import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { required } from "../config";
export const randomToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
function key() {
  const value = Buffer.from(required("TOKEN_ENCRYPTION_KEY"), "base64");
  if (value.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must contain 32 random bytes, base64 encoded.");
  return value;
}
export function encrypt(value: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(b => b.toString("base64url")).join(".");
}
export function decrypt(value: string) {
  const [iv, tag, data] = value.split(".").map(s => Buffer.from(s, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
