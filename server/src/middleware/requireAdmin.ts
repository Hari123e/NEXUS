import { createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { getPool } from "../database.js";

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const sessionToken = req.cookies?.nexus_session;

  if (typeof sessionToken !== "string") {
    return res.status(401).json({
      error: "Authentication required."
    });
  }

  try {
    const pool = await getPool();

    const result = await pool.query(
      `SELECT
         u.id,
         u.username,
         u.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > NOW()
         AND u.is_active = TRUE
         AND u.role = 'super_admin'
       LIMIT 1`,
      [hashToken(sessionToken)]
    );

    if (result.rowCount !== 1) {
      return res.status(403).json({
        error: "Super Admin access denied."
      });
    }

    // Make authenticated admin details available to the next route.
    res.locals.admin = result.rows[0];

    return next();

  } catch (error) {
    console.error("Admin authentication error:", error);

    return res.status(500).json({
      error: "Authentication service unavailable."
    });
  }
}
