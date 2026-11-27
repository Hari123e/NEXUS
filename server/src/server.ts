import { createServer } from "node:http";
import { setupRealtime } from "./realtime.js";
import { readFile } from "node:fs/promises";
import express from "express";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import helmet from "helmet";
import dotenv from "dotenv";
import { rateLimit } from "express-rate-limit";
import authRouter from "./routes/auth.js";
import cookieParser from "cookie-parser";
import adminRouter from "./routes/admin.js";
import conversationsRouter from "./routes/conversations.js";
import contactsRouter from "./routes/contacts.js";
import groupsRouter from "./routes/groups.js";
import { requireUser } from "./middleware/requireUser.js";
import { requireAuthenticated } from "./middleware/requireAuthenticated.js";
import { createInvitationHandler } from "./routes/invitations.js";

dotenv.config();

const app = express();
app.set("trust proxy", "loopback");
const publicDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../public"
);
const PORT = Number(process.env.PORT) || 3000;


app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
                connectSrc: [
                    "'self'",
                    "https://matrix-client.matrix.org",
                    "https://account.matrix.org"
                ]
            }
        }
    })
);

app.use(express.json({ limit: "10kb" }));
app.use(cookieParser());

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,

  skip: (req) => {
    return (
      (req.method === "GET" && req.path === "/me") ||
      (req.method === "POST" && req.path === "/logout")
    );
  }
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "healthy",
    service: "NEXUS Backend"
  });
});
// Public Matrix configuration
app.get("/api/matrix/config", async (_req, res) => {
    try {
        const configPath = resolve(
            dirname(fileURLToPath(import.meta.url)),
            "../.matrix-client.json"
        );

        const config = JSON.parse(
            await readFile(configPath, "utf8")
        );

        if (
            typeof config.homeserver !== "string" ||
            typeof config.client_id !== "string"
        ) {
            return res.status(500).json({
                error: "Invalid Matrix configuration."
            });
        }

        res.set("Cache-Control", "no-store");

        return res.json({
            homeserver: config.homeserver,
            client_id: config.client_id
        });

    } catch {
        return res.status(503).json({
            error: "Matrix configuration unavailable."
        });
    }
});
app.use(express.static(publicDir));
app.use("/api/auth", authLimiter, authRouter);
app.post("/api/invitations", requireAuthenticated, createInvitationHandler);
app.use("/api/admin", adminRouter);
app.use("/api/contacts", requireUser, contactsRouter);
app.use("/api/groups", requireUser, groupsRouter);app.use("/api/conversations", requireUser, conversationsRouter);
app.use("/api/contacts", requireUser, contactsRouter);
app.use("/api/conversations", requireUser, conversationsRouter);
app.use("/api/groups", requireUser, groupsRouter);

const httpServer = createServer(app);

setupRealtime(httpServer);

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`NEXUS server running on port ${PORT}`);
});
