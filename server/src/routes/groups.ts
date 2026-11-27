
import { Router } from "express";
import { getPool } from "../database.js";

const router = Router();

function isValidUUID(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

// ==========================================
// CREATE GROUP
// ==========================================

router.post("/", async (req, res) => {
  const user = res.locals.user;

  const name =
    typeof req.body?.name === "string"
      ? req.body.name.trim()
      : "";

  const description =
    typeof req.body?.description === "string"
      ? req.body.description.trim()
      : "";

  const requestedMembers = req.body?.memberIds;

  if (name.length < 1 || name.length > 50) {
    return res.status(400).json({
      error: "Group name must contain 1–50 characters."
    });
  }

  if (description.length > 250) {
    return res.status(400).json({
      error: "Description cannot exceed 250 characters."
    });
  }

  if (
    !Array.isArray(requestedMembers) ||
    requestedMembers.length === 0 ||
    requestedMembers.length > 99 ||
    !requestedMembers.every(
      (id: unknown) =>
        typeof id === "string" && isValidUUID(id)
    )
  ) {
    return res.status(400).json({
      error: "Select between 1 and 99 valid contacts."
    });
  }

  const memberIds = [...new Set(requestedMembers)];

  if (memberIds.includes(user.id)) {
    return res.status(400).json({
      error: "You cannot add yourself as a member."
    });
  }

  let client;
  let transactionStarted = false;

  try {
    const pool = await getPool();
    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    // Verify every selected user is an accepted contact.
    const contactsResult = await client.query(
      `SELECT c.contact_user_id
       FROM contacts c
       JOIN users u ON u.id = c.contact_user_id
       WHERE c.user_id = $1
         AND c.contact_user_id = ANY($2::UUID[])
         AND u.is_active = TRUE
         AND u.role = 'user'`,
      [user.id, memberIds]
    );

    if (contactsResult.rowCount !== memberIds.length) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(403).json({
        error: "All group members must be active accepted contacts."
      });
    }

    // Create the group conversation.
    const conversationResult = await client.query(
      `INSERT INTO conversations (type, created_by)
       VALUES ('group', $1)
       RETURNING id`,
      [user.id]
    );

    const conversationId = conversationResult.rows[0].id;

    // Save group information.
    await client.query(
      `INSERT INTO group_details
       (conversation_id, name, description)
       VALUES ($1, $2, $3)`,
      [conversationId, name, description]
    );

    // Add the creator as owner.
    await client.query(
      `INSERT INTO conversation_members
       (conversation_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [conversationId, user.id]
    );

    // Add selected contacts as regular members.
    for (const memberId of memberIds) {
      await client.query(
        `INSERT INTO conversation_members
         (conversation_id, user_id)
         VALUES ($1, $2)`,
        [conversationId, memberId]
      );
    }

    await client.query("COMMIT");
    transactionStarted = false;

    return res.status(201).json({
      message: "Group created successfully.",
      group: {
        id: conversationId,
        name,
        description,
        created_by: user.id,
        member_count: memberIds.length + 1
      }
    });

  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK").catch(() => {});
    }

    console.error("Group creation error:", error);

    return res.status(500).json({
      error: "Could not create group."
    });

  } finally {
    client?.release();
  }
});


// ==========================================
// LIST MY GROUPS
// ==========================================

router.get("/", async (req, res) => {
  const user = res.locals.user;

  try {
    const pool = await getPool();

const result = await pool.query(
  `SELECT
     c.id,
     gd.name,
     gd.description,
     cm.role,
     c.created_at,
     c.last_message_at,
     latest.body AS last_message,
     latest.created_at AS last_message_created_at,
     latest.sender_username AS last_message_sender,
     (
       SELECT COUNT(*)::INTEGER
       FROM messages unread
       WHERE unread.conversation_id = c.id
         AND unread.sender_id <> cm.user_id
         AND unread.deleted_at IS NULL
         AND (
           cm.last_read_at IS NULL
           OR unread.created_at > cm.last_read_at
         )
     ) AS unread_count,
     (
       SELECT COUNT(*)::INTEGER
       FROM conversation_members members
       WHERE members.conversation_id = c.id
         AND members.left_at IS NULL
     ) AS member_count
   FROM conversations c
   JOIN group_details gd
     ON gd.conversation_id = c.id
   JOIN conversation_members cm
     ON cm.conversation_id = c.id
   LEFT JOIN LATERAL (
     SELECT
       m.body,
       m.created_at,
       u.username AS sender_username
     FROM messages m
     JOIN users u ON u.id = m.sender_id
     WHERE m.conversation_id = c.id
       AND m.deleted_at IS NULL
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT 1
   ) latest ON TRUE
   WHERE cm.user_id = $1
     AND cm.left_at IS NULL
     AND c.type = 'group'
   ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
  [user.id]
);

    return res.json({
      groups: result.rows
    });

  } catch (error) {
    console.error("Group listing error:", error);

    return res.status(500).json({
      error: "Could not load groups."
    });
  }
});


 
// ==========================================
// LIST GROUP MEMBERS
// ==========================================

router.get("/:id/members", async (req, res) => {
  const user = res.locals.user;
  const groupId = req.params.id;

  if (!isValidUUID(groupId)) {
    return res.status(400).json({
      error: "Invalid group ID."
    });
  }

  try {
    const pool = await getPool();

    // Verify that the requesting user belongs to this group.
    const access = await pool.query(
      `SELECT 1
       FROM conversation_members
       WHERE conversation_id = $1
         AND user_id = $2
         AND left_at IS NULL`,
      [groupId, user.id]
    );

    if (access.rowCount === 0) {
      return res.status(403).json({
        error: "You are not a member of this group."
      });
    }

    const result = await pool.query(
      `SELECT
         u.id,
         u.username,
         cm.role,
         cm.joined_at
       FROM conversation_members cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.conversation_id = $1
         AND cm.left_at IS NULL
         AND u.is_active = TRUE
       ORDER BY
         CASE cm.role
           WHEN 'owner' THEN 1
           WHEN 'admin' THEN 2
           ELSE 3
         END,
         u.username ASC`,
      [groupId]
    );

    return res.json({
      members: result.rows
    });

  } catch (error) {
    console.error("Group members error:", error);

    return res.status(500).json({
      error: "Could not load group members."
    });
  }
});


 
// ==========================================
// GET GROUP DETAILS
// ==========================================

router.get("/:id", async (req, res) => {
  const user = res.locals.user;
  const groupId = req.params.id;

  if (!isValidUUID(groupId)) {
    return res.status(400).json({
      error: "Invalid group ID."
    });
  }

  try {
    const pool = await getPool();

    const result = await pool.query(
      `SELECT
         c.id,
         gd.name,
         gd.description,
         c.created_at,
         c.last_message_at,
         cm.role,
         (
           SELECT COUNT(*)::INTEGER
           FROM conversation_members members
           WHERE members.conversation_id = c.id
             AND members.left_at IS NULL
         ) AS member_count
       FROM conversations c
       JOIN group_details gd
         ON gd.conversation_id = c.id
       JOIN conversation_members cm
         ON cm.conversation_id = c.id
       WHERE c.id = $1
         AND c.type = 'group'
         AND cm.user_id = $2
         AND cm.left_at IS NULL`,
      [groupId, user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Group not found or you are not a member."
      });
    }

    return res.json({
      group: result.rows[0]
    });

  } catch (error) {
    console.error("Group details error:", error);

    return res.status(500).json({
      error: "Could not load group details."
    });
  }
});


 
// ==========================================
// ADD GROUP MEMBERS
// ==========================================

router.post("/:id/members", async (req, res) => {
  const user = res.locals.user;
  const groupId = req.params.id;
  const memberIds = req.body?.memberIds;

  if (!isValidUUID(groupId)) {
    return res.status(400).json({
      error: "Invalid group ID."
    });
  }

  if (
    !Array.isArray(memberIds) ||
    memberIds.length < 1 ||
    memberIds.length > 99 ||
    !memberIds.every(
      (id: unknown) =>
        typeof id === "string" && isValidUUID(id)
    )
  ) {
    return res.status(400).json({
      error: "Provide between 1 and 99 valid member IDs."
    });
  }

  const uniqueIds = [...new Set(memberIds)];

  let client;
  let transactionStarted = false;

  try {
    const pool = await getPool();
    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    // Check the requester's role and lock the group membership.
    const access = await client.query(
      `SELECT role
       FROM conversation_members
       WHERE conversation_id = $1
         AND user_id = $2
         AND left_at IS NULL
       FOR UPDATE`,
      [groupId, user.id]
    );

    if (
      access.rows.length === 0 ||
      !["owner", "admin"].includes(access.rows[0].role)
    ) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(403).json({
        error: "Only group owners and admins can add members."
      });
    }

    // Verify that all selected users are accepted contacts.
    const contacts = await client.query(
      `SELECT c.contact_user_id
       FROM contacts c
       JOIN users u ON u.id = c.contact_user_id
       WHERE c.user_id = $1
         AND c.contact_user_id = ANY($2::UUID[])
         AND u.is_active = TRUE
         AND u.role = 'user'`,
      [user.id, uniqueIds]
    );

    if (contacts.rowCount !== uniqueIds.length) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(403).json({
        error: "All selected users must be active accepted contacts."
      });
    }

    // Check existing active members.
    const existing = await client.query(
      `SELECT user_id
       FROM conversation_members
       WHERE conversation_id = $1
         AND user_id = ANY($2::UUID[])
         AND left_at IS NULL`,
      [groupId, uniqueIds]
    );

    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(409).json({
        error: "One or more selected users are already group members."
      });
    }

    // Add members. Rejoin users who previously left.
    for (const memberId of uniqueIds) {
      await client.query(
        `INSERT INTO conversation_members
         (conversation_id, user_id, role, left_at, joined_at)
         VALUES ($1, $2, 'member', NULL, NOW())
         ON CONFLICT (conversation_id, user_id)
         DO UPDATE SET
           role = 'member',
           left_at = NULL,
           joined_at = NOW()`,
        [groupId, memberId]
      );
    }

    await client.query("COMMIT");
    transactionStarted = false;

    return res.status(201).json({
      message: "Members added successfully.",
      added_count: uniqueIds.length
    });

  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK").catch(() => {});
    }

    console.error("Add group members error:", error);

    return res.status(500).json({
      error: "Could not add group members."
    });

  } finally {
    client?.release();
  }
});


 
// ==========================================
// REMOVE GROUP MEMBER
// ==========================================

router.delete("/:id/members/:userId", async (req, res) => {
  const user = res.locals.user;
  const groupId = req.params.id;
  const targetUserId = req.params.userId;

  if (!isValidUUID(groupId) || !isValidUUID(targetUserId)) {
    return res.status(400).json({
      error: "Invalid group or user ID."
    });
  }

  if (targetUserId === user.id) {
    return res.status(400).json({
      error: "Use the leave group option to remove yourself."
    });
  }

  let client;
  let transactionStarted = false;

  try {
    const pool = await getPool();
    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    const access = await client.query(
      `SELECT role
       FROM conversation_members
       WHERE conversation_id = $1
         AND user_id = $2
         AND left_at IS NULL
       FOR UPDATE`,
      [groupId, user.id]
    );

    if (access.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(403).json({
        error: "You are not a member of this group."
      });
    }

    const actorRole = access.rows[0].role;

    if (!["owner", "admin"].includes(actorRole)) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(403).json({
        error: "You do not have permission to remove members."
      });
    }

    const target = await client.query(
      `SELECT role
       FROM conversation_members
       WHERE conversation_id = $1
         AND user_id = $2
         AND left_at IS NULL
       FOR UPDATE`,
      [groupId, targetUserId]
    );

    if (target.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(404).json({
        error: "Group member not found."
      });
    }

    const targetRole = target.rows[0].role;

    if (
      targetRole === "owner" ||
      (actorRole === "admin" && targetRole !== "member")
    ) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(403).json({
        error: "You cannot remove this member."
      });
    }

    await client.query(
      `UPDATE conversation_members
       SET left_at = NOW()
       WHERE conversation_id = $1
         AND user_id = $2`,
      [groupId, targetUserId]
    );

    await client.query("COMMIT");
    transactionStarted = false;

    return res.json({
      message: "Member removed successfully."
    });

  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK").catch(() => {});
    }

    console.error("Remove group member error:", error);

    return res.status(500).json({
      error: "Could not remove group member."
    });

  } finally {
    client?.release();
  }
});


 
// ==========================================
// LEAVE GROUP
// ==========================================

router.post("/:id/leave", async (req, res) => {
  const user = res.locals.user;
  const groupId = req.params.id;

  if (!isValidUUID(groupId)) {
    return res.status(400).json({
      error: "Invalid group ID."
    });
  }

  try {
    const pool = await getPool();

    const result = await pool.query(
      `UPDATE conversation_members
       SET left_at = NOW()
       WHERE conversation_id = $1
         AND user_id = $2
         AND left_at IS NULL
         AND role != 'owner'
       RETURNING user_id`,
      [groupId, user.id]
    );

    if (result.rowCount === 0) {
      const membership = await pool.query(
        `SELECT role
         FROM conversation_members
         WHERE conversation_id = $1
           AND user_id = $2
         LIMIT 1`,
        [groupId, user.id]
      );

      if (membership.rows.length === 0) {
        return res.status(404).json({
          error: "Group membership not found."
        });
      }

      if (membership.rows[0].role === "owner") {
        return res.status(403).json({
          error: "Transfer group ownership before leaving."
        });
      }

      return res.status(400).json({
        error: "You have already left this group."
      });
    }

    return res.json({
      message: "You left the group successfully."
    });

  } catch (error) {
    console.error("Leave group error:", error);

    return res.status(500).json({
      error: "Could not leave group."
    });
  }
});


 
// ==========================================
// TRANSFER GROUP OWNERSHIP
// ==========================================

router.put("/:id/owner", async (req, res) => {
  const user = res.locals.user;
  const groupId = req.params.id;
  const newOwnerId = req.body?.newOwnerId;

  if (
    !isValidUUID(groupId) ||
    typeof newOwnerId !== "string" ||
    !isValidUUID(newOwnerId)
  ) {
    return res.status(400).json({
      error: "Invalid group or new owner ID."
    });
  }

  if (newOwnerId === user.id) {
    return res.status(400).json({
      error: "You are already the group owner."
    });
  }

  let client;
  let transactionStarted = false;

  try {
    const pool = await getPool();
    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    // Verify and lock the current owner's membership.
    const currentOwner = await client.query(
      `SELECT role
       FROM conversation_members
       WHERE conversation_id = $1
         AND user_id = $2
         AND left_at IS NULL
       FOR UPDATE`,
      [groupId, user.id]
    );

    if (
      currentOwner.rows.length === 0 ||
      currentOwner.rows[0].role !== "owner"
    ) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(403).json({
        error: "Only the current owner can transfer ownership."
      });
    }

    // Verify the new owner is an active group member.
    const newOwner = await client.query(
      `SELECT role
       FROM conversation_members
       WHERE conversation_id = $1
         AND user_id = $2
         AND left_at IS NULL
       FOR UPDATE`,
      [groupId, newOwnerId]
    );

    if (newOwner.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(404).json({
        error: "The new owner must be an active group member."
      });
    }

    // Demote the current owner.
    await client.query(
      `UPDATE conversation_members
       SET role = 'admin'
       WHERE conversation_id = $1
         AND user_id = $2`,
      [groupId, user.id]
    );

    // Promote the selected member.
    await client.query(
      `UPDATE conversation_members
       SET role = 'owner'
       WHERE conversation_id = $1
         AND user_id = $2`,
      [groupId, newOwnerId]
    );

    await client.query("COMMIT");
    transactionStarted = false;

    return res.json({
      message: "Group ownership transferred successfully."
    });

  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK").catch(() => {});
    }

    console.error("Ownership transfer error:", error);

    return res.status(500).json({
      error: "Could not transfer group ownership."
    });

  } finally {
    client?.release();
  }
});


 
// ==========================================
// CHANGE GROUP MEMBER ROLE
// ==========================================

router.put("/:id/members/:userId/role", async (req, res) => {
  const user = res.locals.user;
  const groupId = req.params.id;
  const targetUserId = req.params.userId;
  const newRole = req.body?.role;

  if (
    !isValidUUID(groupId) ||
    !isValidUUID(targetUserId)
  ) {
    return res.status(400).json({
      error: "Invalid group or user ID."
    });
  }

  if (!["admin", "member"].includes(newRole)) {
    return res.status(400).json({
      error: "Role must be admin or member."
    });
  }

  if (targetUserId === user.id) {
    return res.status(400).json({
      error: "You cannot change your own role."
    });
  }

  let client;
  let transactionStarted = false;

  try {
    const pool = await getPool();
    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    const owner = await client.query(
      `SELECT role
       FROM conversation_members
       WHERE conversation_id = $1
         AND user_id = $2
         AND left_at IS NULL
       FOR UPDATE`,
      [groupId, user.id]
    );

    if (
      owner.rows.length === 0 ||
      owner.rows[0].role !== "owner"
    ) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(403).json({
        error: "Only the group owner can manage admin roles."
      });
    }

    const target = await client.query(
      `SELECT role
       FROM conversation_members
       WHERE conversation_id = $1
         AND user_id = $2
         AND left_at IS NULL
       FOR UPDATE`,
      [groupId, targetUserId]
    );

    if (target.rows.length === 0) {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(404).json({
        error: "Active group member not found."
      });
    }

    if (target.rows[0].role === "owner") {
      await client.query("ROLLBACK");
      transactionStarted = false;

      return res.status(400).json({
        error: "The owner role cannot be changed here."
      });
    }

    await client.query(
      `UPDATE conversation_members
       SET role = $1
       WHERE conversation_id = $2
         AND user_id = $3`,
      [newRole, groupId, targetUserId]
    );

    await client.query("COMMIT");
    transactionStarted = false;

    return res.json({
      message: `Member role changed to ${newRole}.`,
      role: newRole
    });

  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK").catch(() => {});
    }

    console.error("Group role update error:", error);

    return res.status(500).json({
      error: "Could not update member role."
    });

  } finally {
    client?.release();
  }
});



// ==========================================
// DELETE GROUP (OWNER ONLY)
// ==========================================

router.delete("/:id", async (req, res) => {
  const user = res.locals.user;
  const groupId = req.params.id;

  if (!isValidUUID(groupId)) {
    return res.status(400).json({ error: "Invalid group ID." });
  }

  let client;
  let transactionStarted = false;

  try {
    const pool = await getPool();
    client = await pool.connect();

    await client.query("BEGIN");
    transactionStarted = true;

    const access = await client.query(
      `SELECT c.type, cm.role
       FROM conversations c
       JOIN conversation_members cm
         ON cm.conversation_id = c.id
       WHERE c.id = $1
         AND cm.user_id = $2
         AND cm.left_at IS NULL
       FOR UPDATE OF c, cm`,
      [groupId, user.id]
    );

    if (!access.rows.length || access.rows[0].type !== "group") {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(404).json({ error: "Group not found." });
    }

    if (access.rows[0].role !== "owner") {
      await client.query("ROLLBACK");
      transactionStarted = false;
      return res.status(403).json({
        error: "Only the group owner can delete this group."
      });
    }

    await client.query(
      "DELETE FROM conversations WHERE id = $1 AND type = 'group'",
      [groupId]
    );

    await client.query("COMMIT");
    transactionStarted = false;

    return res.json({ message: "Group deleted successfully." });

  } catch (error) {
    if (client && transactionStarted) {
      await client.query("ROLLBACK").catch(() => {});
    }

    console.error("Delete group error:", error);
    return res.status(500).json({ error: "Could not delete group." });

  } finally {
    client?.release();
  }
});

export default router;

