import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "./schema";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function buildDBClient(dbPath: string, runMigrations = false) {
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite, { schema });
  if (runMigrations) {
    migrateDB(db);
  }
  return db;
}

export function migrateDB(db: BetterSQLite3Database<typeof schema>) {
  migrate(db, { migrationsFolder: path.join(__dirname, "drizzle") });
}
