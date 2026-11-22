
import { Router } from "express";
import { getPool } from "../database.js";

const router = Router();

function isValidUUID(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// ==========================================
// LIST ACCEPTED CONTACTS
// ==========================================

router.get("/", async (_req, res) => {
  const user = res.locals.user;

  try {
    const pool = await getPool();

    const result = await pool.query(
      `SELECT
         u.id,
         u.username,
         c.created_at AS connected_at
       FROM contacts c
       JOIN users u ON u.id = c.contact_user_id
       WHERE c.user_id = $1
         AND u.is_active = TRUE
         AND u.role = 'user'
       ORDER BY u.username ASC`,
      [user.id]
    );

    return res.json({
      total: result.rows.length,
      contacts: result.rows
    });

  } catch (error) {
    console.error("Contact listing error:", error);

    return res.status(500).json({
      error: "Could not retrieve contacts."
    });
  }
});

// ==========================================
// LIST PENDING CONTACT REQUESTS
// ==========================================

router.get("/requests", async (_req, res) => {
  const user = res.locals.user;

  try {
    const pool = await getPool();

    const result = await pool.query(
      `SELECT
         cr.id,
         cr.status,
         cr.created_at,
         cr.sender_id,
         sender.username AS sender_username,
         cr.recipient_id,
         recipient.username AS recipient_username
       FROM contact_requests cr
       JOIN users sender ON sender.id = cr.sender_id
       JOIN users recipient ON recipient.id = cr.recipient_id
       WHERE cr.status = 'pending'
         AND (cr.sender_id = $1 OR cr.recipient_id = $1)
         AND sender.is_active = TRUE
         AND recipient.is_active = TRUE
       ORDER BY cr.created_at DESC`,
      [user.id]
    );

    const incoming = result.rows.filter(
      (request) => request.recipient_id === user.id
    );

    const outgoing = result.rows.filter(
      (request) => request.sender_id === user.id
    );

    return res.json({ incoming, outgoing });

  } catch (error) {
    console.error("Contact request listing error:", error);

    return res.status(500).json({
      error: "Could not retrieve contact requests."
    });
  }
});

// ==========================================
// SEND CONTACT REQUEST
// ==========================================

router.post("/requests", async (req, res) => {
  const user = res.locals.user;
  const username = req.body?.username;

  if (
    typeof username !== "string" ||
    !/^[a-zA-Z0-9_]{3,30}$/.test(username.trim())
  ) {
    return res.status(400).json({
      error: "Enter a valid NEXUS username."
    });
  }

  try {
    const pool = await getPool();

    const targetResult = await pool.query(
      `SELECT id, username
       FROM users
       WHERE LOWER(username) = LOWER($1)
         AND role = 'user'
         AND is_active = TRUE
       LIMIT 1`,
      [username.trim()]
    );

    if (targetResult.rowCount !== 1) {
      return res.status(404).json({
        error: "No active NEXUS user found with that username."
      });
    }

    const target = targetResult.rows[0];

    if (target.id === user.id) {
      return res.status(400).json({
        error: "You cannot add yourself."
      });
    }

    const poolCheck = await pool.query(
      `SELECT 1
       FROM contacts
       WHERE user_id = $1
         AND contact_user_id = $2
       LIMIT 1`,
      [user.id, target.id]
    );

    if (poolCheck.rowCount === 1) {
      return res.status(409).json({
        error: "This user is already in your contacts."
      });
    }

    const existingRequest = await pool.query(
      `SELECT id, sender_id, recipient_id
       FROM contact_requests
       WHERE status = 'pending'
         AND (
           (sender_id = $1 AND recipient_id = $2)
           OR
           (sender_id = $2 AND recipient_id = $1)
         )
       LIMIT 1`,
      [user.id, target.id]
    );

    if (existingRequest.rowCount === 1) {
      const request = existingRequest.rows[0];

      return res.status(409).json({
        error: request.sender_id === user.id
          ? "You have already sent a request to this user."
          : "This user has already sent you a request. Accept it from incoming requests."
      });
    }

    const result = await pool.query(
      `INSERT INTO contact_requests (sender_id, recipient_id)
       VALUES ($1, $2)
       RETURNING id, status, created_at`,
      [user.id, target.id]
    );

    await pool.query(
      `INSERT INTO audit_logs (actor_user_id, target_user_id, action)
       VALUES ($1, $2, 'contact_request_created')`,
      [user.id, target.id]
    );

    return res.status(201).json({
      message: "Contact request sent successfully.",
      request: result.rows[0],
      recipient: {
        id: target.id,
        username: target.username
      }
    });

  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      return res.status(409).json({
        error: "A pending request already exists between these users."
      });
    }

    console.error("Contact request creation error:", error);

    return res.status(500).json({
      error: "Could not send contact request."
    });
  }
});

// ==========================================
// ACCEPT OR REJECT INCOMING REQUEST
// ==========================================

// ==========================================
// CANCEL OUTGOING REQUEST
// ==========================================

router.post("/requests/:id/cancel", async (req, res) => {
  const user = res.locals.user;
  const { id } = req.params;

  if (!isValidUUID(id)) {
    return res.status(400).json({
      error: "Invalid request ID."
    });
  }

  try {
    const pool = await getPool();

    const result = await pool.query(
      `UPDATE contact_requests
       SET status = 'cancelled',
           updated_at = NOW()
       WHERE id = $1
         AND sender_id = $2
         AND status = 'pending'
       RETURNING recipient_id`,
      [id, user.id]
    );

    if (result.rowCount !== 1) {
      return res.status(404).json({
        error: "Pending outgoing request not found."
      });
    }

    await pool.query(
      `INSERT INTO audit_logs (actor_user_id, target_user_id, action)
       VALUES ($1, $2, 'contact_request_cancelled')`,
      [user.id, result.rows[0].recipient_id]
    );

    return res.json({
      message: "Contact request cancelled."
    });

  } catch (error) {
    console.error("Contact request cancellation error:", error);

    return res.status(500).json({
      error: "Could not cancel contact request."
    });
  }
});


router.post("/requests/:id/:action", async (req, res) => {
  const user = res.locals.user;
  const { id, action } = req.params;

  if (!isValidUUID(id)) {
    return res.status(400).json({
      error: "Invalid request ID."
    });
  }

  if (action !== "accept" && action !== "reject") {
    return res.status(400).json({
      error: "Invalid request action."
    });
  }

  let client;

  try {
    const pool = await getPool();
    client = await pool.connect();

    await client.query("BEGIN");

    const requestResult = await client.query(
      `SELECT id, sender_id, recipient_id, status
       FROM contact_requests
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    if (requestResult.rowCount !== 1) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Contact request not found."
      });
    }

    const request = requestResult.rows[0];

    if (request.recipient_id !== user.id) {
      await client.query("ROLLBACK");

      return res.status(403).json({
        error: "Only the recipient can accept or reject this request."
      });
    }

    if (request.status !== "pending") {
      await client.query("ROLLBACK");

      return res.status(409).json({
        error: "This request is no longer pending."
      });
    }

    const participants = await client.query(
      `SELECT id
       FROM users
       WHERE id = ANY($1::UUID[])
         AND is_active = TRUE
         AND role = 'user'
       FOR UPDATE`,
      [[request.sender_id, request.recipient_id]]
    );

    if (participants.rowCount !== 2) {
      await client.query("ROLLBACK");

      return res.status(403).json({
        error: "Both accounts must be active normal-user accounts."
      });
    }

    if (action === "accept") {
      await client.query(
        `INSERT INTO contacts (user_id, contact_user_id)
         VALUES
           ($1, $2),
           ($2, $1)
         ON CONFLICT DO NOTHING`,
        [request.sender_id, request.recipient_id]
      );
    }

    await client.query(
      `UPDATE contact_requests
       SET status = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [action === "accept" ? "accepted" : "rejected", id]
    );

    await client.query(
      `INSERT INTO audit_logs (actor_user_id, target_user_id, action)
       VALUES ($1, $2, $3)`,
      [
        user.id,
        request.sender_id,
        action === "accept"
          ? "contact_request_accepted"
          : "contact_request_rejected"
      ]
    );

    await client.query("COMMIT");

    return res.json({
      message: action === "accept"
        ? "Contact request accepted."
        : "Contact request rejected."
    });

  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }

    console.error("Contact request action error:", error);

    return res.status(500).json({
      error: "Could not process contact request."
    });

  } finally {
    client?.release();
  }
});

// ==========================================
// REMOVE ACCEPTED CONTACT
// ==========================================

router.delete("/:contactUserId", async (req, res) => {
  const user = res.locals.user;
  const contactUserId = req.params.contactUserId;

  if (!isValidUUID(contactUserId)) {
    return res.status(400).json({
      error: "Invalid contact ID."
    });
  }

  if (contactUserId === user.id) {
    return res.status(400).json({
      error: "Invalid contact."
    });
  }

  let client;

  try {
    const pool = await getPool();
    client = await pool.connect();

    await client.query("BEGIN");

    const result = await client.query(
      `DELETE FROM contacts
       WHERE (
         (user_id = $1 AND contact_user_id = $2)
         OR
         (user_id = $2 AND contact_user_id = $1)
       )
       RETURNING user_id`,
      [user.id, contactUserId]
    );

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Contact not found."
      });
    }

    await client.query(
      `INSERT INTO audit_logs (actor_user_id, target_user_id, action)
       VALUES ($1, $2, 'contact_removed')`,
      [user.id, contactUserId]
    );

    await client.query("COMMIT");

    return res.json({
      message: "Contact removed successfully."
    });

  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }

    console.error("Contact removal error:", error);

    return res.status(500).json({
      error: "Could not remove contact."
    });

  } finally {
    client?.release();
  }
});

export default router;

