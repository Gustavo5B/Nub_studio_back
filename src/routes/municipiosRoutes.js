// routes/municipiosRoutes.js
import { Router } from "express";
import {
    listarMunicipiosPorEstado,
    getMunicipiosHidalgo
} from "../controllers/municipiosController.js";

const router = Router();

router.get("/:id_estado", listarMunicipiosPorEstado);

router.get("/hidalgo/count", getMunicipiosHidalgo);

export default router;