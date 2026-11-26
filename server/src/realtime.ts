
import { createHash } from "node:crypto";
import type { Server } from "node:http";
import { URL } from "node:url";
import {
  WebSocket,
  WebSocketServer
} from "ws";
import { getPool } from "./database.js";

interface ClientInfo {
  userId: string;
  conversations: Set<string>;
}

const clients = new Map<WebSocket, ClientInfo>();

function rejectUpgrade(socket: import("node:stream").Duplex, status = 401) {
  socket.write(
    `HTTP/1.1 ${status} Unauthorized\r\nConnection: close\r\n\r\n`
  );
  socket.destroy();
}

function getSessionToken(cookieHeader = ""): string | null {
  const cookies = cookieHeader.split(";");

  for (const cookie of cookies) {
    const [name, ...parts] = cookie.trim().split("=");

    if (name === "nexus_session") {
      return parts.join("=") || null;
    }
  }

  return null;
}

export function setupRealtime(server: Server) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 1024
  });

  server.on("upgrade", (request, socket, head) => {
    void (async () => {
      try {
        const url = new URL(
          request.url || "/",
          "http://localhost"
        );

        if (url.pathname !== "/ws") {
          return rejectUpgrade(socket, 404);
        }

        const origin = request.headers.origin;
        const host = request.headers.host;

        if (!origin || !host || new URL(origin).host !== host) {
          return rejectUpgrade(socket, 403);
        }

        const token = getSessionToken(
          request.headers.cookie
        );

        if (!token) {
          return rejectUpgrade(socket);
        }

        const tokenHash = createHash("sha256")
          .update(token)
          .digest();

        const pool = await getPool();

        const result = await pool.query(
          `SELECT u.id
           FROM sessions s
           JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = $1
             AND s.revoked_at IS NULL
             AND s.expires_at > NOW()
             AND u.is_active = TRUE
             AND u.role = 'user'
           LIMIT 1`,
          [tokenHash]
        );

        if (result.rowCount !== 1) {
          return rejectUpgrade(socket);
        }

        const userId = result.rows[0].id;

        wss.handleUpgrade(request, socket, head, (ws) => {
          clients.set(ws, {
            userId,
            conversations: new Set()
          });

          wss.emit("connection", ws, request);
        });
      } catch (error) {
        console.error("WebSocket connection error:", error);
        rejectUpgrade(socket, 500);
      }
    })();
  });

  wss.on("connection", (ws) => {
    ws.on("message", async (raw) => {
      try {
        const info = clients.get(ws);
        if (!info) return;

        const data = JSON.parse(raw.toString());

        const isJoin = data.type === "join";
        const isDelivered = data.type === "delivered";

        if (
          (!isJoin && !isDelivered) ||
          typeof data.conversationId !== "string" ||
          !/^[0-9a-f-]{36}$/i.test(data.conversationId)
        ) {
          return;
        }

        if (
          isDelivered &&
          (typeof data.messageId !== "string" ||
           !/^[0-9a-f-]{36}$/i.test(data.messageId))
        ) {
          return;
        }

        const pool = await getPool();

        const access = await pool.query(
          `SELECT 1
           FROM conversation_members
           WHERE conversation_id = $1
             AND user_id = $2
             AND left_at IS NULL
           LIMIT 1`,
          [data.conversationId, info.userId]
        );

        if (access.rowCount !== 1) {
          ws.send(JSON.stringify({
            type: "error",
            message: "Conversation access denied."
          }));
          return;
        }

        if (isDelivered) {
          if (!info.conversations.has(data.conversationId)) {
            return;
          }

          const result = await pool.query(
            `UPDATE messages
             SET delivered_at = COALESCE(delivered_at, NOW())
             WHERE id = $1
               AND conversation_id = $2
               AND sender_id <> $3
               AND deleted_at IS NULL
             RETURNING id`,
            [data.messageId, data.conversationId, info.userId]
          );

          if (result.rowCount === 1) {
            const receipt = JSON.stringify({
              type: "message_delivered",
              conversationId: data.conversationId,
              messageId: data.messageId
            });

            for (const [client, clientInfo] of clients) {
              if (
                clientInfo.conversations.has(data.conversationId) &&
                client.readyState === WebSocket.OPEN
              ) {
                client.send(receipt);
              }
            }
          }

          return;
        }

        info.conversations.add(data.conversationId);

        ws.send(JSON.stringify({
          type: "joined",
          conversationId: data.conversationId
        }));
      } catch {
        ws.send(JSON.stringify({
          type: "error",
          message: "Invalid WebSocket message."
        }));
      }
    });

    ws.on("close", () => {
      clients.delete(ws);
    });

    ws.on("error", () => {
      clients.delete(ws);
    });
  });

  console.log("NEXUS WebSocket service initialized.");
}

export function broadcastToConversation(
  conversationId: string,
  message: unknown
) {
  const payload = JSON.stringify({
    type: "new_message",
    conversationId,
    message
  });

  for (const [ws, info] of clients) {
    if (
      info.conversations.has(conversationId) &&
      ws.readyState === WebSocket.OPEN
    ) {
      ws.send(payload);
    }
  }
}



export function broadcastReadReceipt(
  conversationId: string,
  readerId: string,
  readAt: string
) {
  const payload = JSON.stringify({
    type: "messages_read",
    conversationId,
    readerId,
    readAt
  });

  for (const [ws, info] of clients) {
    if (
      info.conversations.has(conversationId) &&
      info.userId !== readerId &&
      ws.readyState === WebSocket.OPEN
    ) {
      ws.send(payload);
    }
  }
}
