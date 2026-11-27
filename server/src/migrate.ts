
import { readFile } from "node:fs/promises";
import { getPool } from "./database.js";

async function migrate() {
  const pool = await getPool();
  const client = await pool.connect();

  try {
    const schema = await readFile(
      new URL("./schema.sql", import.meta.url),
      "utf8"
    );

    console.log("\nStarting NEXUS database migration...");

    await client.query("BEGIN");

    try {
      await client.query(schema);

      await client.query(`
        ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ
      `);

      await client.query("COMMIT");

      console.log("\nNEXUS DATABASE MIGRATION SUCCESSFUL!");
      console.log("All six tables created or verified.");
      console.log("Group roles and group details are ready.");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } catch (error) {
    console.error("\nMIGRATION FAILED:");

    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(error);
    }

    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
