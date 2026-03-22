import { Router } from "express";
import { getMunicipiosHidalgo } from "../controllers/municipiosController.js";

const router = Router();
router.get("/hidalgo/count", getMunicipiosHidalgo);

export default router;
