import { pool, pools } from "../config/db.js";
import logger from "../config/logger.js";

// =========================================================
// ESTADISTICAS PARA EL DASHBOARD ADMIN
// =========================================================
export const getDashboardStats = async (req, res) => {
  try {
    const db = pools[req.user.rol] || pool;

    const [
      obrasResult,
      artistasResult,
      categoriasResult,
      obrasEstadoResult,
      obrasRecientesResult,
      visitasResult
    ] = await Promise.all([

      db.query(`
        SELECT COUNT(*) as total 
        FROM obras 
        WHERE eliminada IS NOT TRUE
      `),

      db.query(`
        SELECT COUNT(*) as total 
        FROM artistas 
        WHERE estado = 'activo'
      `),

      db.query(`
        SELECT COUNT(*) as total 
        FROM categorias
      `),

      db.query(`
        SELECT estado, COUNT(*) as total 
        FROM obras 
        WHERE eliminada IS NOT TRUE
        GROUP BY estado
      `),

      db.query(`
        SELECT 
          o.id_obra, o.titulo, o.imagen_principal, 
          o.estado, o.fecha_creacion,
          a.nombre_artistico AS artista_alias, 
          a.nombre_completo AS artista_nombre,
          c.nombre AS categoria_nombre
        FROM obras o
        INNER JOIN artistas a ON o.id_artista = a.id_artista
        INNER JOIN categorias c ON o.id_categoria = c.id_categoria
        WHERE o.eliminada IS NOT TRUE
        ORDER BY o.fecha_creacion DESC
        LIMIT 5
      `),

      db.query(`
        SELECT COALESCE(SUM(vistas), 0) as total 
        FROM obras 
        WHERE eliminada IS NOT TRUE
      `)
    ]);

    const estadosMap = {};
    obrasEstadoResult.rows.forEach((r) => {
      estadosMap[r.estado] = parseInt(r.total);
    });

    res.json({
      success: true,
      data: {
        kpis: {
          total_obras:      parseInt(obrasResult.rows[0].total),
          obras_publicadas: estadosMap['publicada'] || 0,
          obras_pendientes: estadosMap['pendiente'] || 0,
          obras_rechazadas: estadosMap['rechazada'] || 0,
        },
        strip: {
          artistas_activos: parseInt(artistasResult.rows[0].total),
          categorias:       parseInt(categoriasResult.rows[0].total),
          visitas_total:    parseInt(visitasResult.rows[0].total),
        },
        obras_recientes: obrasRecientesResult.rows,
      }
    });

  } catch (error) {
    logger.error(`Error al obtener estadisticas: ${error.message}`);
    res.status(500).json({ success: false, message: 'Error al obtener estadisticas' });
  }
};