
import { Router } from "express";
import { createHash, randomBytes } from "node:crypto";
import { getPool } from "../database.js";

const router = Router();

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

// CREATE INVITATION
router.post("/", async (req, res) => {
  const maxUses = req.body?.maxUses ?? 1;
  const expiresInHours = req.body?.expiresInHours ?? 72;
  const admin = res.locals.admin;

  if (
    !Number.isInteger(maxUses) ||
    maxUses < 1 ||
    maxUses > 100
  ) {
    return res.status(400).json({
      error: "maxUses must be between 1 and 100."
    });
  }

  if (
    !Number.isInteger(expiresInHours) ||
    expiresInHours < 1 ||
    expiresInHours > 720
  ) {
    return res.status(400).json({
      error: "Expiry must be between 1 and 720 hours."
    });
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);

  try {
    const pool = await getPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `INSERT INTO invitations
         (token_hash, created_by, max_uses, expires_at)
         VALUES (
           $1, $2, $3,
           NOW() + ($4 * INTERVAL '1 hour')
         )
         RETURNING id, max_uses, expires_at, created_at`,
        [tokenHash, admin.id, maxUses, expiresInHours]
      );

      await client.query(
        `INSERT INTO audit_logs
         (actor_user_id, action, details)
         VALUES ($1, $2, $3)`,
        [
          admin.id,
          "invitation_created",
          JSON.stringify({
            invitationId: result.rows[0].id,
            maxUses,
            expiresInHours
          })
        ]
      );

      await client.query("COMMIT");

      return res.status(201).json({
        message: "Invitation created successfully.",
        invitation: result.rows[0],
        token
      });

    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error("Invitation creation error:", error);

    return res.status(500).json({
      error: "Could not create invitation."
    });
  }
});

// LIST INVITATIONS
router.get("/", async (_req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.query(
      `SELECT
         id,
         max_uses,
         uses,
         expires_at,
         revoked_at,
         created_at
       FROM invitations
       ORDER BY created_at DESC
       LIMIT 100`
    );

    return res.json({
      invitations: result.rows
    });

  } catch (error) {
    console.error("Invitation listing error:", error);

    return res.status(500).json({
      error: "Could not retrieve invitations."
    });
  }
});

// REVOKE INVITATION
router.post("/:id/revoke", async (req, res) => {
  const { id } = req.params;
  const admin = res.locals.admin;

  if (
    typeof id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    return res.status(400).json({
      error: "Invalid invitation ID."
    });
  }

  try {
    const pool = await getPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `UPDATE invitations
         SET revoked_at = NOW()
         WHERE id = $1
           AND revoked_at IS NULL
         RETURNING id`,
        [id]
      );

      if (result.rowCount !== 1) {
        await client.query("ROLLBACK");

        return res.status(404).json({
          error: "Invitation not found or already revoked."
        });
      }

      await client.query(
        `INSERT INTO audit_logs
         (actor_user_id, action, details)
         VALUES ($1, $2, $3)`,
        [
          admin.id,
          "invitation_revoked",
          JSON.stringify({ invitationId: id })
        ]
      );

      await client.query("COMMIT");

      return res.json({
        message: "Invitation revoked successfully."
      });

    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error("Invitation revocation error:", error);

    return res.status(500).json({
      error: "Could not revoke invitation."
    });
  }
});

export default router;

