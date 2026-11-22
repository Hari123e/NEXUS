import { readFile } from "node:fs/promises";
import { getPool } from "./database.js";

async function migrate() {
  const pool = await getPool();

  try {
    const schema = await readFile(
      new URL("./schema.sql", import.meta.url),
      "utf8"
    );

    await pool.query("BEGIN");

    try {
      await pool.query(schema);
      await pool.query("COMMIT");

      console.log("\nNEXUS DATABASE MIGRATION SUCCESSFUL!");
      console.log("Created or verified all five tables.");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  } catch (error) {
    console.error("\nMIGRATION FAILED:");

    if (error instanceof Error) {
      console.error(error.message);
    }
  } finally {
    await pool.end();
  }
}

migrate();
