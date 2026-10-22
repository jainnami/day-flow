/** Keep pg's existing certificate/hostname verification explicit across upgrades. */
export function connectionStringForPg(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("DATABASE_URL must use postgres:// or postgresql://.");
  const mode = url.searchParams.get("sslmode");
  if (url.searchParams.get("uselibpqcompat") === "true" || !mode || !["prefer", "require", "verify-ca"].includes(mode)) return value;
  // These modes currently alias verify-full in pg. Avoid relying on that alias.
  url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}
