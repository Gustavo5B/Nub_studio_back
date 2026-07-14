import { Router } from 'express';
import { getTamañosPorObra, listarTamañosPublico } from '../controllers/tamañosController.js';
import { getMarcosPorObraTamaño, listarMarcosPublico } from '../controllers/marcosController.js';

const router = Router();

// Catálogo de tamaños activos (usado por artista portal y DetalleObra)
router.get('/tamanos', listarTamañosPublico);

// Tamaños asignados a una obra (público — para DetalleObra)
router.get('/obras/:id_obra/tamanos', getTamañosPorObra);

// Marcos del catálogo activos (público)
router.get('/marcos', listarMarcosPublico);

// Marcos disponibles para una combinación obra+tamaño
router.get('/obra-tamano/:id_obra_tamano/marcos', getMarcosPorObraTamaño);

export default router;
