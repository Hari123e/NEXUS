
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { randomBytes } from "node:crypto";
import { argon2id } from "hash-wasm";
import { getPool } from "../database.js";

async function readHidden(prompt: string): Promise<string> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("Run this script directly in Termux.");
  }

  stdout.write(prompt);
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
        } else if (byte >= 32 && byte <= 126) {
          value += String.fromCharCode(byte);
        }
      }
    };

    stdin.on("data", onData);
  });
}

async function resetPassword() {
  const pool = await getPool();

  try {
    const password = await readHidden("Enter NEW password: ");
    const confirmation = await readHidden("Confirm NEW password: ");

    if (password !== confirmation) {
      throw new Error("Passwords do not match.");
    }

    if (password.length < 12 || Buffer.byteLength(password, "utf8") > 1024) {
      throw new Error("Password must be at least 12 characters and at most 1024 bytes.");
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

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `UPDATE users
         SET password_hash = $1, updated_at = NOW()
         WHERE LOWER(username) = LOWER($2)
           AND role = 'super_admin'
         RETURNING id, username`,
        [passwordHash, "Hari123e"]
      );

      if (result.rowCount !== 1) {
        throw new Error("Super Admin account not found.");
      }

      await client.query(
        `UPDATE sessions
         SET revoked_at = NOW()
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [result.rows[0].id]
      );

      await client.query(
        `INSERT INTO audit_logs (actor_user_id, action)
         VALUES ($1, 'super_admin_password_reset')`,
        [result.rows[0].id]
      );

      await client.query("COMMIT");

      console.log("\nSUPER ADMIN PASSWORD RESET SUCCESSFULLY!");

    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

  } finally {
    await pool.end();
  }
}

resetPassword().catch((error) => {
  console.error("\nRESET FAILED:", error.message);
  process.exitCode = 1;
});

