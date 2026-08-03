import fs from "node:fs/promises";
import path from "node:path";
import { query, pool } from ".";

async function main() {
  const schema = await fs.readFile(path.join(__dirname, "schema.sql"), "utf8");
  await query(schema);
  console.log("Database schema applied");
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exitCode = 1;
});
