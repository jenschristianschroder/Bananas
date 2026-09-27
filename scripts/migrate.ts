import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const sql = neon(process.env.DATABASE_URL);
const here = dirname(fileURLToPath(import.meta.url));
const sqlDir = join(here, "..", "sql");
const files = (await readdir(sqlDir))
  .filter((name) => /^\d+_.*\.sql$/.test(name))
  .sort();

for (const name of files) {
  const migration = await readFile(join(sqlDir, name), "utf8");
  for (const statement of migration.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean)) {
    await sql.query(statement);
  }
  console.log("Applied " + name);
}

console.log("Migrations complete");
