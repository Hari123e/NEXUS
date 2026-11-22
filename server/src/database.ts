import { Pool } from "pg";
import { parse } from "pg-connection-string";
import { resolve4 } from "node:dns/promises";
import { createRequire } from "node:module";
import dotenv from "dotenv";

dotenv.config();

let pool: Pool | null = null;

export async function getPool(): Promise<Pool> {
  if (pool) return pool;

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is missing from .env");
  }

  const config = parse(databaseUrl);

  if (!config.host) {
    throw new Error("Database hostname is missing");
  }

  const originalHost = config.host;
  const addresses = await resolve4(originalHost);
  const databaseIP = addresses[0];

  if (!databaseIP) {
    throw new Error("Could not resolve database hostname");
  }

  console.log("Neon hostname resolved successfully.");

  pool = new Pool({
    host: databaseIP,
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
