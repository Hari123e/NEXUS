import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
res.json({
project: "NEXUS",
message: "NEXUS server is running!",
status: "online"
});
});

app.get("/api/health", (_req, res) => {
res.json({
status: "healthy",
service: "NEXUS Backend"
});
});

app.listen(PORT, "0.0.0.0", () => {
console.log("NEXUS server running on port ${PORT}");
});