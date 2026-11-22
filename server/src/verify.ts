import { getPool } from "./database.js";

async function verify() {
  const pool = await getPool();

  try {
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    console.log("\nNEXUS DATABASE TABLES:");

    for (const row of result.rows) {
      console.log("✓", row.table_name);
    }

    console.log("\nTotal tables:", result.rowCount);
  } catch (error) {
    console.error("Verification failed:", error);
  } finally {
    await pool.end();
  }
}

verify();
