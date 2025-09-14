import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "./schema";

export type Options = {
  runMigrations?: boolean;
  walEnabled?: boolean;
};

const DEFAULT_DB_OPTIONS: Required<Options> = {
  runMigrations: false,
  walEnabled: true,
};

export function buildDBClient(dbPath: string, _options: Options = {}) {
  const options = { ...DEFAULT_DB_OPTIONS, ..._options };

  const sqlite = new Database(dbPath);
  if (options.walEnabled) {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("synchronous = NORMAL");
  } else {
    sqlite.pragma("journal_mode = DELETE");
  }
  sqlite.pragma("cache_size = -65536");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("temp_store = MEMORY");

  const db = drizzle(sqlite, { schema });
  if (options.runMigrations) {
    migrateDB(db);
  }

  return db;
}

export function migrateDB(db: BetterSQLite3Database<typeof schema>) {
  const migrationsPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "drizzle",
  );
  migrate(db, { migrationsFolder: migrationsPath });
}
