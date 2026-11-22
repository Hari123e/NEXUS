import { argon2Verify } from "hash-wasm";
import { getPool } from "../database.js";

async function checkPassword() {
  const password = process.env.NEXUS_PASSWORD;

  if (!password) {
    console.log("No password was supplied.");
    return;
  }

  const pool = await getPool();

  try {
    const result = await pool.query(
      `SELECT username, password_hash
       FROM users
       WHERE LOWER(username) = LOWER($1)
         AND role = 'super_admin'`,
      ["Hari123e"]
    );

    if (result.rowCount !== 1) {
      console.log("Super Admin account not found.");
      return;
    }

    const valid = await argon2Verify({
      password,
      hash: result.rows[0].password_hash
    });

    console.log(
      valid
        ? "PASSWORD VERIFIED SUCCESSFULLY!"
        : "PASSWORD DOES NOT MATCH."
    );

  } finally {
    await pool.end();
  }
}

checkPassword().catch((error) => {
  console.error("Verification error:", error.message);
  process.exitCode = 1;
});
