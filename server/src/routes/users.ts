
import { Router } from "express";
import { getPool } from "../database.js";

const router = Router();

function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// LIST AND SEARCH USERS
router.get("/", async (req, res) => {
  const search = req.query.search;

  if (
    search !== undefined &&
    (typeof search !== "string" || search.length > 30)
  ) {
    return res.status(400).json({
      error: "Invalid search query."
    });
  }

  try {
    const pool = await getPool();

    const result = await pool.query(
      `SELECT
         u.id,
         u.username,
         u.role,
         u.is_active,
         u.created_at,
         u.last_login_at,
         (
           SELECT COUNT(*)::INTEGER
           FROM sessions s
           WHERE s.user_id = u.id
             AND s.revoked_at IS NULL
             AND s.expires_at > NOW()
         ) AS active_sessions,
         (
           SELECT COUNT(*)::INTEGER
           FROM devices d
           WHERE d.user_id = u.id
             AND d.verification_status = 'verified'
         ) AS verified_devices
       FROM users u
       WHERE ($1::TEXT IS NULL OR u.username ILIKE '%' || $1 || '%')
       ORDER BY u.created_at DESC
       LIMIT 100`,
      [search || null]
    );

    return res.json({
      total: result.rows.length,
      users: result.rows
    });

  } catch (error) {
    console.error("User listing error:", error);

    return res.status(500).json({
      error: "Could not retrieve users."
    });
  }
});

// ACTIVATE OR DEACTIVATE A USER
router.patch("/:id/status", async (req, res) => {
  const id = req.params.id;
  const isActive = req.body?.isActive;
  const admin = res.locals.admin;

  if (!isValidUUID(id)) {
    return res.status(400).json({
      error: "Invalid user ID."
    });
  }

  if (typeof isActive !== "boolean") {
    return res.status(400).json({
      error: "isActive must be true or false."
    });
  }

  if (id === admin.id) {
    return res.status(400).json({
      error: "You cannot change your own account status."
    });
  }

  let client;

  try {
    const pool = await getPool();
    client = await pool.connect();

    await client.query("BEGIN");

    const target = await client.query(
      `SELECT id, role, is_active
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    if (target.rowCount !== 1) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "User not found."
      });
    }

    if (target.rows[0].role !== "user") {
      await client.query("ROLLBACK");

      return res.status(403).json({
        error: "Super Admin accounts cannot be modified here."
      });
    }

    await client.query(
      `UPDATE users
       SET is_active = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [isActive, id]
    );

    let revokedSessions = 0;

    if (!isActive) {
      const revoked = await client.query(
        `UPDATE sessions
         SET revoked_at = NOW()
         WHERE user_id = $1
           AND revoked_at IS NULL`,
        [id]
      );

      revokedSessions = revoked.rowCount ?? 0;
    }

    await client.query(
      `INSERT INTO audit_logs
       (actor_user_id, target_user_id, action, details)
       VALUES ($1, $2, $3, $4)`,
      [
        admin.id,
        id,
        isActive ? "user_activated" : "user_deactivated",
        JSON.stringify({ revokedSessions })
      ]
    );

    await client.query("COMMIT");

    return res.json({
      message: isActive
        ? "User activated successfully."
        : "User deactivated successfully.",
      revokedSessions
    });

  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }

    console.error("User status update error:", error);

    return res.status(500).json({
      error: "Could not update user status."
    });

  } finally {
    client?.release();
  }
});

// REVOKE ALL USER SESSIONS
router.post("/:id/revoke-sessions", async (req, res) => {
  const id = req.params.id;
  const admin = res.locals.admin;

  if (!isValidUUID(id)) {
    return res.status(400).json({
      error: "Invalid user ID."
    });
  }

  if (id === admin.id) {
    return res.status(400).json({
      error: "You cannot revoke your own sessions here."
    });
  }

  let client;

  try {
    const pool = await getPool();
    client = await pool.connect();

    await client.query("BEGIN");

    const target = await client.query(
      `SELECT id, role
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    if (target.rowCount !== 1) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "User not found."
      });
    }

    if (target.rows[0].role !== "user") {
      await client.query("ROLLBACK");

      return res.status(403).json({
        error: "Super Admin sessions cannot be modified here."
      });
    }

    const result = await client.query(
      `UPDATE sessions
       SET revoked_at = NOW()
       WHERE user_id = $1
         AND revoked_at IS NULL`,
      [id]
    );

    const revokedCount = result.rowCount ?? 0;

    await client.query(
      `INSERT INTO audit_logs
       (actor_user_id, target_user_id, action, details)
       VALUES ($1, $2, $3, $4)`,
      [
        admin.id,
        id,
        "user_sessions_revoked",
        JSON.stringify({ revokedCount })
      ]
    );

    await client.query("COMMIT");

    return res.json({
      message: "User sessions revoked successfully.",
      revokedCount
    });

  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }

    console.error("Session revocation error:", error);

    return res.status(500).json({
      error: "Could not revoke user sessions."
    });

  } finally {
    client?.release();
  }
});


// PERMANENTLY DELETE A NORMAL USER
router.delete("/:id", async (req, res) => {
  const id = req.params.id;
  const admin = res.locals.admin;

  if (!isValidUUID(id)) {
    return res.status(400).json({
      error: "Invalid user ID."
    });
  }

  if (id === admin.id) {
    return res.status(400).json({
      error: "You cannot delete your own account."
    });
  }

  let client;

  try {
    const pool = await getPool();
    client = await pool.connect();

    await client.query("BEGIN");

    const target = await client.query(
      `SELECT id, username, role
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    if (target.rowCount !== 1) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        error: "User not found."
      });
    }

    const user = target.rows[0];

    if (user.role !== "user") {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: "Super Admin accounts cannot be deleted here."
      });
    }

    // Transfer ownership of groups to another existing admin/member.
    const ownedGroups = await client.query(
      `SELECT conversation_id
       FROM conversation_members
       WHERE user_id = $1
         AND role = 'owner'
         AND left_at IS NULL
       FOR UPDATE`,
      [id]
    );

    for (const group of ownedGroups.rows) {
      const replacement = await client.query(
        `SELECT user_id
         FROM conversation_members
         WHERE conversation_id = $1
           AND user_id <> $2
           AND left_at IS NULL
         ORDER BY
           CASE role
             WHEN 'admin' THEN 1
             WHEN 'member' THEN 2
             ELSE 3
           END,
           joined_at ASC
         LIMIT 1
         FOR UPDATE`,
        [group.conversation_id, id]
      );

      if (replacement.rowCount === 1) {
        await client.query(
          `UPDATE conversation_members
           SET role = 'owner'
           WHERE conversation_id = $1
             AND user_id = $2`,
          [group.conversation_id, replacement.rows[0].user_id]
        );
      } else {
        // No other active members: remove the empty group.
        await client.query(
          `DELETE FROM conversations
           WHERE id = $1
             AND type = 'group'`,
          [group.conversation_id]
        );
      }
    }

    // Preserve audit history before deleting the user.
    await client.query(
      `INSERT INTO audit_logs
       (actor_user_id, target_user_id, action, details)
       VALUES ($1, $2, $3, $4)`,
      [
        admin.id,
        id,
        "user_deleted",
        JSON.stringify({ username: user.username })
      ]
    );

    // Foreign-key cascades clean up dependent records.
    await client.query(
      `DELETE FROM users
       WHERE id = $1`,
      [id]
    );

    await client.query("COMMIT");

    return res.json({
      message: `User ${user.username} was permanently deleted.`
    });

  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }

    console.error("User deletion error:", error);

    return res.status(500).json({
      error: "Could not delete user."
    });

  } finally {
    client?.release();
  }
});


export default router;

