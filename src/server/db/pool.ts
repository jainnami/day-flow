import "server-only";
import { Pool, type PoolClient } from "pg";
import { required } from "../config";
const shared = globalThis as unknown as { rightNowPool?: Pool };
export function pool() {
  return shared.rightNowPool ??= new Pool({ connectionString: required("DATABASE_URL"), max: 5, connectionTimeoutMillis: 5000 });
}
export async function userTransaction<T>(userId: string, run: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool().connect();
  try {
    await db.query("BEGIN");
    // All app writes for a user take this lock, including settings/disconnect.
    const user = await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    if (!user.rowCount) throw new Error("User missing.");
    const result = await run(db);
    await db.query("COMMIT");
    return result;
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}
