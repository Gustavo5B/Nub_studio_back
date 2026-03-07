// src/routes/reportesRoutes.js
import { Router } from "express";
import multer     from "multer";
import { authenticateToken, requireRole } from "../middlewares/authMiddleware.js";
import {
  getKPIs,
  getVentasPorMes,
  getIngresosVsComisiones,
  getTopObras,
  getTopArtistas,
  exportarVentas,
  exportarFinanciero,
  exportarArtistas,
  exportarCatalogoObras,
  exportarObrasPlantilla,
  exportarArtistasPlantilla,
  importarObras,
  importarArtistas,
} from "../controllers/Reportescontroller.js";

const router = Router();

// multer en memoria — sin guardar en disco, máx 10 MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            || file.originalname.endsWith(".xlsx");
    cb(ok ? null : new Error("Solo se aceptan archivos .xlsx"), ok);
  },
});

// Todos los endpoints de reportes son solo para admin
router.use(authenticateToken, requireRole("admin"));

// ── Datos para gráficas y KPIs ──────────────────────────
router.get("/kpis",                   getKPIs);
router.get("/ventas-por-mes",         getVentasPorMes);
router.get("/ingresos-vs-comisiones", getIngresosVsComisiones);
router.get("/top-obras",              getTopObras);
router.get("/top-artistas",           getTopArtistas);

// ── Exportaciones xlsx ───────────────────────────────────
router.get("/exportar/ventas",              exportarVentas);
router.get("/exportar/financiero",          exportarFinanciero);
router.get("/exportar/artistas",            exportarArtistas);
router.get("/exportar/catalogo-obras",      exportarCatalogoObras);
router.get("/exportar/obras-plantilla",     exportarObrasPlantilla);
router.get("/exportar/artistas-plantilla",  exportarArtistasPlantilla);

// ── Importaciones xlsx ───────────────────────────────────
router.post("/importar/obras",     upload.single("archivo"), importarObras);
router.post("/importar/artistas",  upload.single("archivo"), importarArtistas);

export default router;