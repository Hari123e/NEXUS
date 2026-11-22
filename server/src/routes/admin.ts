import usersRouter from "./users.js";
import { Router } from "express";
import { requireAdmin } from "../middleware/requireAdmin.js";
import invitationsRouter from "./invitations.js";
const router = Router();

// All routes below require Super Admin authentication.
router.use(requireAdmin);
router.use("/invitations", invitationsRouter);
router.use("/users", usersRouter);
// ==========================================
// ADMIN PROFILE
// ==========================================

router.get("/me", (_req, res) => {
  const admin = res.locals.admin;

  return res.json({
    message: "Super Admin authentication successful!",
    admin: {
      id: admin.id,
      username: admin.username,
      role: admin.role
    }
  });
});

// ==========================================
// ADMIN DASHBOARD STATUS
// ==========================================

router.get("/dashboard", (_req, res) => {
  return res.json({
    project: "NEXUS",
    dashboard: "Super Admin",
    status: "protected",
    message: "Welcome to the NEXUS Admin Dashboard."
  });
});

export default router;
