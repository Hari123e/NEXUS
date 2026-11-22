import express from "express";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import helmet from "helmet";
import dotenv from "dotenv";
import { rateLimit } from "express-rate-limit";
import authRouter from "./routes/auth.js";
import cookieParser from "cookie-parser";
import adminRouter from "./routes/admin.js";

dotenv.config();

const app = express();
const publicDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../public"
);
const PORT = Number(process.env.PORT) || 3000;

app.use(helmet());
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
app.use(express.static(publicDir));
app.use("/api/auth", authLimiter, authRouter);
app.use("/api/admin", adminRouter);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`NEXUS server running on port ${PORT}`);
});
