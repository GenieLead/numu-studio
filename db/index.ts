import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export function getDb() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not configured. Set it in your Vercel environment variables."
    );
  }

  const sql = neon(databaseUrl);
  return drizzle(sql, { schema });
}
