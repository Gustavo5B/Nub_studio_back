import { Router } from "express";
import { getDashboardStats } from "../controllers/statsController.js";
import { authenticateToken, requireRole } from "../middlewares/authMiddleware.js";

const router = Router();

router.get("/dashboard", authenticateToken, requireRole('admin'), getDashboardStats);

export default router;