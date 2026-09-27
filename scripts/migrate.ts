import { readFile } from "node:fs/promises";
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = neon(process.env.DATABASE_URL);
const migration = await readFile(new URL("../sql/001_init.sql", import.meta.url), "utf8");
for (const statement of migration.split(/;\s*(?:\n|$)/).map(s => s.trim()).filter(Boolean)) {
  await sql.query(statement);
}
console.log("Migration complete");
