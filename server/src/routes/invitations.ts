import { Router } from "express";
import { createHash, randomBytes } from "node:crypto";
import { getPool } from "../database.js";

const router = Router();

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

// CREATE INVITATION — shared by users and admins
export async function createInvitationHandler(req: any, res: any) {
  const maxUses = req.body?.maxUses ?? 1;
  const expiresInHours = req.body?.expiresInHours ?? 72;

  // Admin middleware sets admin; shared middleware sets actor.
  const actor = res.locals.actor ?? res.locals.admin;

  if (!actor) {
    return res.status(401).json({
      error: "Authentication required."
    });
  }

  // Normal users can only create one-use invitations.
  const isAdmin = actor.role === "super_admin";

  if (!isAdmin && maxUses !== 1) {
    return res.status(400).json({
      error: "User invitations can only be used once."
    });
  }

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
    expiresInHours > 720 ||
    (!isAdmin && expiresInHours > 72)
  ) {
    return res.status(400).json({
      error: "Invalid invitation expiry."
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
        [tokenHash, actor.id, maxUses, expiresInHours]
      );

      await client.query(
        `INSERT INTO audit_logs
         (actor_user_id, action, details)
         VALUES ($1, $2, $3)`,
        [
          actor.id,
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
}

// Admin invitation routes are protected by requireAdmin in admin.ts.
router.post("/", createInvitationHandler);

// LIST INVITATIONS
router.get("/", async (_req, res) => {
  try {
    const pool = await getPool();

    const result = await pool.query(
      `SELECT
         i.id,
         i.max_uses,
         i.uses,
         i.expires_at,
         i.revoked_at,
         i.created_at,
         u.username AS created_by_username
       FROM invitations i
       LEFT JOIN users u ON u.id = i.created_by
       ORDER BY i.created_at DESC
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

  if (!admin) {
    return res.status(403).json({
      error: "Super Admin access required."
    });
  }

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
