import type { D1Database } from "@cloudflare/workers-types";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";

export type Database = DrizzleD1Database;

export function openDatabase(d1: D1Database): Database {
  return drizzle(d1);
}
