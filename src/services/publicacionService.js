import { pool } from '../config/db.js';
import logger from '../config/logger.js';

// =========================================================
// Publicación programada
// Publica automáticamente las colecciones y obras cuyo estado
// es 'programada' y cuya fecha programada ya llegó.
// - Colecciones: las programa el propio artista.
// - Obras: quedan 'programada' cuando el admin aprueba una obra
//   que tiene fecha_publicacion_programada futura.
// Lo invoca un cron cada 5 minutos desde server.js (y una vez al
// arrancar, para recuperar publicaciones perdidas por downtime).
// =========================================================
export const publicarProgramadas = async () => {
  const coleccionesRes = await pool.query(`
    UPDATE colecciones
    SET estado = 'publicada', fecha_actualizacion = NOW()
    WHERE estado = 'programada'
      AND fecha_publicacion_programada IS NOT NULL
      AND fecha_publicacion_programada <= NOW()
      AND eliminada = FALSE
    RETURNING id_coleccion, nombre
  `);

  const obrasRes = await pool.query(`
    UPDATE obras
    SET estado = 'publicada', activa = TRUE, visible = TRUE, fecha_actualizacion = NOW()
    WHERE estado = 'programada'
      AND fecha_publicacion_programada IS NOT NULL
      AND fecha_publicacion_programada <= NOW()
      AND eliminada IS NOT TRUE
    RETURNING id_obra, titulo
  `);

  if (coleccionesRes.rowCount > 0 || obrasRes.rowCount > 0) {
    logger.info(
      `Publicación programada: ${coleccionesRes.rowCount} colección(es) y ${obrasRes.rowCount} obra(s) publicadas`
    );
  }

  return { colecciones: coleccionesRes.rowCount, obras: obrasRes.rowCount };
};
