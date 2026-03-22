import { Router } from "express";
import {
  getSobreNosotrosController,
  getTrayectoriaController,
  updateSobreNosotrosController,
  updateTrayectoriaController,
} from "../controllers/sobreNosotrosController.js";

const router = Router();

router.get("/", getSobreNosotrosController);
router.get("/trayectoria", getTrayectoriaController);
router.put("/", updateSobreNosotrosController);
router.put("/trayectoria", updateTrayectoriaController);

export default router;
