
import { Router } from "express";
import { createHash, randomBytes } from "node:crypto";
import { argon2id, argon2Verify } from "hash-wasm";
import { getPool } from "../database.js";

const router = Router();

const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000;

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: SESSION_DURATION
  };
}

// ==========================================
// REGISTER
// ==========================================

router.post("/register", async (req, res) => {
  const { username, password, invitation } = req.body ?? {};

  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    typeof invitation !== "string"
  ) {
    return res.status(400).json({
      error: "Username, password and invitation are required."
    });
  }

  const cleanUsername = username.trim();

  if (!/^[a-zA-Z0-9_]{3,30}$/.test(cleanUsername)) {
    return res.status(400).json({
      error: "Invalid username."
    });
  }

  if (
    password.length < 12 ||
    Buffer.byteLength(password, "utf8") > 1024
  ) {
    return res.status(400).json({
      error: "Password must be at least 12 characters and at most 1024 bytes."
    });
  }

  if (invitation.length < 32 || invitation.length > 256) {
    return res.status(400).json({
      error: "Invalid invitation."
    });
  }

  let client;

  try {
    const pool = await getPool();
    client = await pool.connect();

    await client.query("BEGIN");

    const inviteResult = await client.query(
      `SELECT id
       FROM invitations
       WHERE token_hash = $1
       AND revoked_at IS NULL
       AND expires_at > NOW()
       AND uses < max_uses
       FOR UPDATE`,
      [hashToken(invitation)]
    );

    if (inviteResult.rowCount !== 1) {
      await client.query("ROLLBACK");

      return res.status(403).json({
        error: "Invalid, expired or already-used invitation."
      });
    }

    const passwordHash = await argon2id({
      password,
      salt: randomBytes(16),
      parallelism: 1,
      iterations: 3,
      memorySize: 65536,
      hashLength: 32,
      outputType: "encoded"
    });

    const userResult = await client.query(
      `INSERT INTO users (username, password_hash)
       VALUES ($1, $2)
       RETURNING id, username, role, created_at`,
      [cleanUsername, passwordHash]
    );

    const user = userResult.rows[0];

    await client.query(
      `UPDATE invitations
       SET uses = uses + 1
       WHERE id = $1`,
      [inviteResult.rows[0].id]
    );

    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action)
       VALUES ($1, 'user_registered')`,
      [user.id]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      message: "NEXUS account created successfully.",
      user
    });

  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      return res.status(409).json({
        error: "That username is already taken."
      });
    }

    console.error("Registration error:", error);

    return res.status(500).json({
      error: "Registration failed. Please try again."
    });

  } finally {
    client?.release();
  }
});

// ==========================================
// LOGIN
// ==========================================

router.post("/login", async (req, res) => {
  const { username, password } = req.body ?? {};

  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    username.length > 30 ||
    password.length > 1024
  ) {
    return res.status(400).json({
      error: "Invalid username or password."
    });
  }

  let client;

  try {
    const pool = await getPool();
    client = await pool.connect();

    const result = await client.query(
      `SELECT id, username, password_hash, role, is_active
       FROM users
       WHERE LOWER(username) = LOWER($1)
       LIMIT 1`,
      [username.trim()]
    );

    if (result.rowCount !== 1) {
      return res.status(401).json({
        error: "Invalid username or password."
      });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(403).json({
        error: "This account is disabled."
      });
    }

    const validPassword = await argon2Verify({
      password,
      hash: user.password_hash
    });

    if (!validPassword) {
      return res.status(401).json({
        error: "Invalid username or password."
      });
    }

    const sessionToken = randomBytes(32).toString("base64url");

    await client.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [
        user.id,
        hashToken(sessionToken),
        new Date(Date.now() + SESSION_DURATION)
      ]
    );

    await client.query(
      `UPDATE users
       SET last_login_at = NOW()
       WHERE id = $1`,
      [user.id]
    );

    await client.query(
      `INSERT INTO audit_logs (actor_user_id, action)
       VALUES ($1, 'user_login')`,
      [user.id]
    );

    res.cookie("nexus_session", sessionToken, cookieOptions());

    return res.json({
      message: "Login successful.",
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });

  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      error: "Login failed. Please try again."
    });

  } finally {
    client?.release();
  }
});

// ==========================================
// CHECK CURRENT SESSION
// ==========================================

router.get("/me", async (req, res) => {
  const sessionToken = req.cookies?.nexus_session;

  if (typeof sessionToken !== "string") {
    return res.status(401).json({
      error: "Not logged in."
    });
  }

  try {
    const pool = await getPool();

    const result = await pool.query(
      `SELECT u.id, u.username, u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1
       AND s.revoked_at IS NULL
       AND s.expires_at > NOW()
       AND u.is_active = TRUE
       LIMIT 1`,
      [hashToken(sessionToken)]
    );

    if (result.rowCount !== 1) {
      res.clearCookie("nexus_session", cookieOptions());

      return res.status(401).json({
        error: "Session expired or invalid."
      });
    }

    return res.json({
      authenticated: true,
      user: result.rows[0]
    });

  } catch (error) {
    console.error("Session verification error:", error);

    return res.status(500).json({
      error: "Could not verify session."
    });
  }
});

// ==========================================
// LOGOUT
// ==========================================

router.post("/logout", async (req, res) => {
  const sessionToken = req.cookies?.nexus_session;

  try {
    if (typeof sessionToken === "string") {
      const pool = await getPool();

      await pool.query(
        `UPDATE sessions
         SET revoked_at = NOW()
         WHERE token_hash = $1
         AND revoked_at IS NULL`,
        [hashToken(sessionToken)]
      );
    }

    res.clearCookie("nexus_session", cookieOptions());

    return res.json({
      message: "Logged out successfully."
    });

  } catch (error) {
    console.error("Logout error:", error);

    return res.status(500).json({
      error: "Logout failed."
    });
  }
});

export default router;

