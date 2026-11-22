import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { randomBytes } from "node:crypto";
import { argon2id } from "hash-wasm";
import { getPool } from "../database.js";

async function readSecret(prompt: string): Promise<string> {
  stdout.write(prompt);

  if (!stdin.isTTY || !stdin.setRawMode) {
    throw new Error("A real Termux terminal is required.");
  }

  stdin.setRawMode(true);
  stdin.resume();

  return new Promise((resolve, reject) => {
    let value = "";

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
    };

    const onData = (data: Buffer) => {
      for (const byte of data) {
        if (byte === 3) {
          cleanup();
          stdout.write("\n");
          reject(new Error("Cancelled."));
          return;
        }

        if (byte === 13 || byte === 10) {
          cleanup();
          stdout.write("\n");
          resolve(value);
          return;
        }

        if (byte === 127 || byte === 8) {
          value = value.slice(0, -1);
          continue;
        }

        if (byte >= 32 && byte <= 126) {
          value += String.fromCharCode(byte);
        }
      }
    };

    stdin.on("data", onData);
  });
}

async function createAdmin() {
  const rl = createInterface({ input: stdin, output: stdout });
  const pool = await getPool();
  const client = await pool.connect();

  try {
    const username = (
      await rl.question("Choose Super Admin username: ")
    ).trim();

    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
      throw new Error("Username must be 3–30 letters, numbers or underscores.");
    }

    const password = await readSecret("Choose password (12+ characters): ");

    if (
      password.length < 12 ||
      Buffer.byteLength(password, "utf8") > 1024
    ) {
      throw new Error("Password must be at least 12 characters and at most 1024 bytes.");
    }

    const confirmation = await readSecret("Confirm password: ");

    if (password !== confirmation) {
      throw new Error("Passwords do not match.");
    }

    const salt = randomBytes(16);

    const passwordHash = await argon2id({
      password,
      salt,
      parallelism: 1,
      iterations: 3,
      memorySize: 65536,
      hashLength: 32,
      outputType: "encoded"
    });

    await client.query("BEGIN");

    // Serialize bootstrap attempts, even if no admin exists yet.
    await client.query(
      "SELECT pg_advisory_xact_lock($1)",
      [781204]
    );

    const existing = await client.query(
      "SELECT id FROM users WHERE role = 'super_admin' LIMIT 1"
    );

    if (existing.rowCount && existing.rowCount > 0) {
      throw new Error("A Super Admin already exists. Bootstrap is disabled.");
    }

    const result = await client.query(
      `INSERT INTO users (username, password_hash, role)
       VALUES ($1, $2, 'super_admin')
       RETURNING id, username, role, created_at`,
      [username, passwordHash]
    );

    const admin = result.rows[0];

    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action)
       VALUES ($1, 'super_admin_created')`,
      [admin.id]
    );

    await client.query("COMMIT");

    console.log("\nSUPER ADMIN CREATED SUCCESSFULLY!");
    console.log("Username:", admin.username);
    console.log("Role:", admin.role);
    console.log("ID:", admin.id);

  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Transaction may not have started.
    }

    console.error("\nADMIN CREATION FAILED:");

    if (error instanceof Error) {
      console.error(error.message);
    }

  } finally {
    client.release();
    rl.close();
    await pool.end();
  }
}

createAdmin();
