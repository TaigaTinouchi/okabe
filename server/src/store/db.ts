import { Database } from "bun:sqlite";
import { dirname, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;

const migrationsFolder = resolve(import.meta.dir, "../../drizzle");

/** DBを開き、マイグレーションを起動時に適用する。`:memory:` はテスト用 */
export function createDb(path: string) {
  if (path !== ":memory:") {
    // SQLite はディレクトリを作らないので先に掘る
    require("node:fs").mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const sqlite = new Database(path, { create: true, strict: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return db;
}
