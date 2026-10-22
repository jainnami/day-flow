import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";
import { connectionStringForPg } from "../src/server/db/connection-string";
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL in .env.local first.");
const pool = new Pool({ connectionString: connectionStringForPg(process.env.DATABASE_URL) });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(74293811)");
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  for (const name of (await readdir("db/migrations")).filter(n => n.endsWith(".sql")).sort()) {
    const done = await client.query("SELECT name FROM schema_migrations WHERE name=$1", [name]);
    if (done.rowCount) continue;
    await client.query(await readFile(`db/migrations/${name}`, "utf8"));
    await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
    console.log(`Applied ${name}`);
  }
  await client.query("COMMIT");
} catch (error) { await client.query("ROLLBACK"); throw error; }
finally { client.release(); await pool.end(); }
