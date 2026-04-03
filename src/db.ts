import path from "node:path";
import { fileURLToPath } from "node:url";
import { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

import * as schema from "./schema";

export type LitequeDB = BaseSQLiteDatabase<any, any, typeof schema>;

export function getMigrationsPath() {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "drizzle",
  );
}
