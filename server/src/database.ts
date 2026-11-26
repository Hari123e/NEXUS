
import { Pool } from "pg";
import { parse } from "pg-connection-string";
import { resolve4 } from "node:dns/promises";
import dotenv from "dotenv";

dotenv.config();

let pool: Pool | null = null;

export async function getPool(): Promise<Pool> {
  if (pool) return pool;

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is missing");
  }

  const config = parse(databaseUrl);
  const originalHost = config.host;

  if (!originalHost) {
    throw new Error("Database hostname is missing");
  }

  let databaseHost = originalHost;

  // Keep the DNS workaround for local Termux development.
  // Render uses normal DNS resolution.
  if (process.env.NODE_ENV !== "production") {
    const addresses = await resolve4(originalHost);
    databaseHost = addresses[0];

    if (!databaseHost) {
      throw new Error("Could not resolve database hostname");
    }

    console.log("Neon hostname resolved using local DNS workaround.");
  } else {
    console.log("Using normal production DNS for Neon.");
  }

  pool = new Pool({
    host: databaseHost,
    port: config.port ? Number(config.port) : 5432,
    database: config.database ?? undefined,
    user: config.user,
    password: config.password,
    ssl: {
      rejectUnauthorized: true,
      servername: originalHost
    },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });

  pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL error:", error.message);
  });

  return pool;
}
