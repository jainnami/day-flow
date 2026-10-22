import "server-only";
export function required(name: string): string {
  const value = process.env[name];
  if (!value || /YOUR_|REPLACE_WITH/.test(value)) throw new Error(`Set ${name} in .env.local before connecting Google.`);
  return value;
}
export function appUrl() {
  const url = new URL(required("APP_URL"));
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("APP_URL must use HTTPS outside localhost.");
  return url.origin;
}
export function setupReady() {
  try { appUrl(); ["DATABASE_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "TOKEN_ENCRYPTION_KEY"].forEach(required); return true; }
  catch { return false; }
}
