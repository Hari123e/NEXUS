import { getPool } from "./database.js";

async function testDatabase() {
  let pool;

  try {
    pool = await getPool();

    const result = await pool.query(
      "SELECT NOW() AS current_time, version() AS database_version"
    );

    console.log("\nNEXUS DATABASE CONNECTED!");
    console.log("Database time:", result.rows[0].current_time);
    console.log("PostgreSQL:", result.rows[0].database_version);

  } catch (error) {
    console.error("\nDATABASE CONNECTION FAILED");

    if (error instanceof Error) {
      console.error(error.message);
    }
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

testDatabase();
