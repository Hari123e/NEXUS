import { Router } from "express";
import { getPool } from "../database.js";
import {
  broadcastToConversation,
  broadcastReadReceipt
} from "../realtime.js";

const router = Router();

function isValidUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// ==========================================
// CREATE OR OPEN DIRECT CONVERSATION
// ==========================================

router.post("/", async (req, res) => {
  const user = res.locals.user;
  const contactUsername = req.body?.username;

  if (
    typeof contactUsername !== "string" ||
    !/^[a-zA-Z0-9_]{3,30}$/.test(contactUsername)
  ) {
    return res.status(400).json({
      error: "Enter a valid contact username."
    });
  }

  let client;

  try {
    const pool = await getPool();
    client = await pool.connect();

    await client.query("BEGIN");

    const contactResult = await client.query(
      `SELECT u.id, u.username
       FROM users u
       JOIN contacts c
         ON c.contact_user_id = u.id
       WHERE c.user_id = $1
         AND LOWER(u.username) = LOWER($2)
         AND u.is_active = TRUE
         AND u.role = 'user'
       LIMIT 1`,
      [user.id, contactUsername]
    );

    if (contactResult.rowCount !== 1) {
      await client.query("ROLLBACK");

      return res.status(404).json({
        error: "Accepted contact not found."
      });
    }

    const contact = contactResult.rows[0];

    const conversationResult = await client.query(
      `INSERT INTO conversations (
         type,
         created_by,
         direct_user_low,
         direct_user_high
       )
       VALUES (
         'direct',
         $1,
         LEAST($1::UUID, $2::UUID),
         GREATEST($1::UUID, $2::UUID)
       )
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [user.id, contact.id]
    );

    let conversationId: string;

    if (conversationResult.rowCount === 1) {
      conversationId = conversationResult.rows[0].id;
    } else {
      const existing = await client.query(
        `SELECT id
         FROM conversations
         WHERE type = 'direct'
           AND direct_user_low = LEAST($1::UUID, $2::UUID)
           AND direct_user_high = GREATEST($1::UUID, $2::UUID)
         LIMIT 1`,
        [user.id, contact.id]
      );

      if (existing.rowCount !== 1) {
        throw new Error("Could not retrieve direct conversation.");
      }

      conversationId = existing.rows[0].id;
    }

    await client.query(
      `INSERT INTO conversation_members (
         conversation_id,
         user_id
       )
       VALUES ($1, $2), ($1, $3)
       ON CONFLICT DO NOTHING`,
      [conversationId, user.id, contact.id]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      message: "Conversation opened.",
      conversation: {
        id: conversationId,
        contact_id: contact.id,
        contact_username: contact.username
      }
    });

  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }

    console.error("Conversation creation error:", error);

    return res.status(500).json({
      error: "Could not open conversation."
    });

  } finally {
    client?.release();
  }
});


// ==========================================
// LIST CONVERSATIONS
// ==========================================

router.get("/", async (_req, res) => {
  const user = res.locals.user;

  try {
    const pool = await getPool();

    const result = await pool.query(
      `SELECT
         c.id,
         c.type,
         c.created_at,
         c.updated_at,
         c.last_message_at,
         other.id AS contact_id,
         other.username AS contact_username,
         latest.body AS last_message,
         latest.created_at AS last_message_created_at,
         (
           SELECT COUNT(*)::INTEGER
           FROM messages unread
           WHERE unread.conversation_id = c.id
             AND unread.sender_id <> mine.user_id
             AND unread.deleted_at IS NULL
             AND (
               mine.last_read_at IS NULL
               OR unread.created_at > mine.last_read_at
             )
         ) AS unread_count
       FROM conversation_members mine
       JOIN conversations c
         ON c.id = mine.conversation_id
       JOIN conversation_members other_member
         ON other_member.conversation_id = c.id
         AND other_member.user_id <> mine.user_id
         AND other_member.left_at IS NULL
       JOIN users other
         ON other.id = other_member.user_id
       LEFT JOIN LATERAL (
         SELECT body, created_at
         FROM messages
         WHERE conversation_id = c.id
           AND deleted_at IS NULL
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       ) latest ON TRUE
       WHERE mine.user_id = $1
         AND mine.left_at IS NULL
         AND c.type = 'direct'
       ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC`,
      [user.id]
    );

    return res.json({
      conversations: result.rows
    });

  } catch (error) {
    console.error("Conversation list error:", error);

    return res.status(500).json({
      error: "Could not load conversations."
    });
  }
});


// ==========================================
// LOAD MESSAGE HISTORY
// ==========================================

router.get("/:id/messages", async (req, res) => {
  const user = res.locals.user;
  const conversationId = req.params.id;

  if (!isValidUUID(conversationId)) {
    return res.status(400).json({
      error: "Invalid conversation ID."
    });
  }

  try {
    const pool = await getPool();

    const access = await pool.query(
      `SELECT 1
       FROM conversation_members
       WHERE conversation_id = $1
         AND user_id = $2
         AND left_at IS NULL
       LIMIT 1`,
      [conversationId, user.id]
    );

    if (access.rowCount !== 1) {
      return res.status(403).json({
        error: "You are not a member of this conversation."
      });
    }

    const readResult = await pool.query(
      `UPDATE conversation_members
       SET last_read_at = NOW()
       WHERE conversation_id = $1
         AND user_id = $2
         AND left_at IS NULL
       RETURNING last_read_at`,
      [conversationId, user.id]
    );

    if (readResult.rows.length > 0) {
      broadcastReadReceipt(
        conversationId,
        user.id,
        new Date(readResult.rows[0].last_read_at).toISOString()
      );
    }

    const result = await pool.query(
      `SELECT
         m.id,
         m.conversation_id,
         m.sender_id,
         u.username AS sender_username,
         m.body,
         m.created_at,
         m.edited_at,
         m.delivered_at,
         CASE
           WHEN m.sender_id = $2
             AND other_member.last_read_at >= m.created_at
           THEN other_member.last_read_at
           ELSE NULL
         END AS read_at
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       LEFT JOIN conversation_members other_member
         ON other_member.conversation_id = m.conversation_id
         AND other_member.user_id <> $2
         AND other_member.left_at IS NULL
       WHERE m.conversation_id = $1
         AND m.deleted_at IS NULL
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT 50`,
      [conversationId, user.id]
    );

    return res.json({
      messages: result.rows.reverse()
    });

  } catch (error) {
    console.error("Message history error:", error);

    return res.status(500).json({
      error: "Could not load messages."
    });
  }
});


// ==========================================
// SEND AND SAVE MESSAGE
// ==========================================

router.post("/:id/messages", async (req, res) => {
  const user = res.locals.user;
  const conversationId = req.params.id;
  const rawBody = req.body?.body;

  if (!isValidUUID(conversationId)) {
    return res.status(400).json({
      error: "Invalid conversation ID."
    });
  }

  if (typeof rawBody !== "string") {
    return res.status(400).json({
      error: "Message body is required."
    });
  }

  const body = rawBody.trim();

  if (body.length === 0 || body.length > 4000) {
    return res.status(400).json({
      error: "Messages must contain between 1 and 4000 characters."
    });
  }

  let client;

  try {
    const pool = await getPool();
    client = await pool.connect();

    await client.query("BEGIN");

    const access = await client.query(
      `SELECT 1
       FROM conversation_members
       WHERE conversation_id = $1
         AND user_id = $2
         AND left_at IS NULL
       FOR UPDATE`,
      [conversationId, user.id]
    );

    if (access.rowCount !== 1) {
      await client.query("ROLLBACK");

      return res.status(403).json({
        error: "You cannot send messages in this conversation."
      });
    }

    const result = await client.query(
      `INSERT INTO messages (
         conversation_id,
         sender_id,
         body
       )
       VALUES ($1, $2, $3)
       RETURNING id, conversation_id, sender_id, body, created_at`,
      [conversationId, user.id, body]
    );

    await client.query(
      `UPDATE conversations
       SET last_message_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [conversationId]
    );

await client.query("COMMIT");

const savedMessage = {
  ...result.rows[0],
  sender_username: user.username
};

// Deliver only after the database successfully saves it.
broadcastToConversation(conversationId, savedMessage);

return res.status(201).json({
  message: savedMessage
});

  } finally {
    client?.release();
  }
});

export default router;
