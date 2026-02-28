import { pool } from "../config/db.js";

// =========================================================
// 📊 ESTADÍSTICAS PARA EL DASHBOARD ADMIN
// =========================================================
export const getDashboardStats = async (req, res) => {
  try {
    const [
      obrasResult,
      artistasResult,
      categoriasResult,
      obrasEstadoResult,
      obrasRecientesResult,
      visitasResult
    ] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total FROM obras WHERE activa = TRUE AND eliminada = FALSE`),
      pool.query(`SELECT COUNT(*) as total FROM artistas WHERE activo = TRUE AND eliminado = FALSE`),
      pool.query(`SELECT COUNT(*) as total FROM categorias WHERE activa = TRUE`),
      pool.query(`
        SELECT estado, COUNT(*) as total 
        FROM obras WHERE activa = TRUE AND eliminada = FALSE
        GROUP BY estado
      `),
      pool.query(`
        SELECT o.id_obra, o.titulo, o.imagen_principal, o.estado, o.fecha_creacion,
          a.nombre_artistico AS artista_alias, a.nombre_completo AS artista_nombre,
          c.nombre AS categoria_nombre
        FROM obras o
        INNER JOIN artistas a ON o.id_artista = a.id_artista
        INNER JOIN categorias c ON o.id_categoria = c.id_categoria
        WHERE o.activa = TRUE AND o.eliminada = FALSE
        ORDER BY o.fecha_creacion DESC
        LIMIT 5
      `),
      pool.query(`SELECT COALESCE(SUM(vistas),0) as total FROM obras WHERE activa = TRUE`)
    ]);

    const estadosMap = {};
    obrasEstadoResult.rows.forEach(r => {
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
    console.error('Error al obtener estadísticas:', error);
    res.status(500).json({ success: false, message: 'Error al obtener estadísticas' });
  }
};