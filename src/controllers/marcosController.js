import { pool, pools } from '../config/db.js';
import logger from '../config/logger.js';

// =========================================================
// ADMIN — catálogo de tipos_marco
// =========================================================

export const listarMarcosAdmin = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM tipos_marco
      WHERE eliminado IS NOT TRUE
      ORDER BY material ASC, precio_adicional ASC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error(`listarMarcosAdmin: ${err.message}`);
    res.status(500).json({ success: false, message: 'Error al obtener marcos' });
  }
};

export const crearMarco = async (req, res) => {
  try {
    const { nombre, descripcion, material, color, precio_adicional, ancho_cm, alto_cm } = req.body;
    if (!nombre?.trim() || precio_adicional === undefined)
      return res.status(400).json({ success: false, message: 'Nombre y precio son requeridos' });

    const result = await pool.query(
      `INSERT INTO tipos_marco
         (nombre, descripcion, material, color, precio_adicional, ancho_cm, alto_cm, activo, eliminado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE,FALSE) RETURNING *`,
      [nombre.trim(), descripcion||null, material||null, color||null,
       precio_adicional, ancho_cm||null, alto_cm||null]
    );
    res.status(201).json({ success: true, message: 'Marco creado', data: result.rows[0] });
  } catch (err) {
    logger.error(`crearMarco: ${err.message}`);
    res.status(500).json({ success: false, message: 'Error al crear marco' });
  }
};

export const actualizarMarco = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, descripcion, material, color, precio_adicional, ancho_cm, alto_cm, activo } = req.body;

    const result = await pool.query(
      `UPDATE tipos_marco
       SET nombre=$1, descripcion=$2, material=$3, color=$4,
           precio_adicional=$5, ancho_cm=$6, alto_cm=$7, activo=$8
       WHERE id_tipo_marco=$9 AND eliminado IS NOT TRUE RETURNING *`,
      [nombre, descripcion||null, material||null, color||null,
       precio_adicional, ancho_cm||null, alto_cm||null, activo !== false, id]
    );
    if (!result.rows.length)
      return res.status(404).json({ success: false, message: 'Marco no encontrado' });

    res.json({ success: true, message: 'Marco actualizado', data: result.rows[0] });
  } catch (err) {
    logger.error(`actualizarMarco: ${err.message}`);
    res.status(500).json({ success: false, message: 'Error al actualizar marco' });
  }
};

export const eliminarMarco = async (req, res) => {
  try {
    const { id } = req.params;
    const enUso = await pool.query(
      'SELECT COUNT(*) AS c FROM obras_marcos WHERE id_tipo_marco=$1 AND activo=TRUE', [id]
    );
    if (parseInt(enUso.rows[0].c) > 0)
      return res.status(409).json({
        success: false,
        message: 'Este marco está asignado a obras activas. Desactívalo primero.',
      });

    await pool.query(
      `UPDATE tipos_marco SET eliminado=TRUE, activo=FALSE, fecha_eliminacion=NOW()
       WHERE id_tipo_marco=$1`, [id]
    );
    res.json({ success: true, message: 'Marco eliminado' });
  } catch (err) {
    logger.error(`eliminarMarco: ${err.message}`);
    res.status(500).json({ success: false, message: 'Error al eliminar marco' });
  }
};

// =========================================================
// PÚBLICO — marcos disponibles para una obra+tamaño
// =========================================================

export const getMarcosPorObraTamaño = async (req, res) => {
  try {
    const { id_obra_tamano } = req.params;
    const result = await pool.query(`
      SELECT
        om.id AS id_obra_marco,
        om.precio_total,
        tm.id_tipo_marco,
        tm.nombre,
        tm.descripcion,
        tm.material,
        tm.color,
        tm.precio_adicional,
        tm.ancho_cm,
        tm.alto_cm,
        tm.imagen
      FROM obras_marcos om
      INNER JOIN tipos_marco tm ON tm.id_tipo_marco = om.id_tipo_marco
      WHERE om.id_obra_tamaño = $1
        AND om.activo = TRUE
        AND tm.activo = TRUE
        AND tm.eliminado IS NOT TRUE
      ORDER BY tm.precio_adicional ASC
    `, [id_obra_tamano]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error(`getMarcosPorObraTamaño: ${err.message}`);
    res.status(500).json({ success: false, message: 'Error al obtener marcos' });
  }
};

// Todos los marcos activos del catálogo (para que el cliente vea opciones)
export const listarMarcosPublico = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id_tipo_marco, nombre, descripcion, material, color,
             precio_adicional, ancho_cm, alto_cm, imagen
      FROM tipos_marco
      WHERE activo = TRUE AND eliminado IS NOT TRUE
      ORDER BY precio_adicional ASC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error(`listarMarcosPublico: ${err.message}`);
    res.status(500).json({ success: false, message: 'Error al obtener marcos' });
  }
};

// =========================================================
// ARTISTA — asignar/quitar marcos a sus obras+tamaños
// =========================================================

export const getObrasMarcos = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const { id_obra_tamano } = req.params;
    const id_usuario = req.user.id_usuario;

    const check = await db.query(
      `SELECT ot.id FROM obras_tamaños ot
       INNER JOIN obras o ON o.id_obra = ot.id_obra
       WHERE ot.id=$1 AND o.id_usuario_creacion=$2 LIMIT 1`,
      [id_obra_tamano, id_usuario]
    );
    if (!check.rows.length)
      return res.status(403).json({ success: false, message: 'No tienes acceso a este registro' });

    const result = await db.query(`
      SELECT om.id, om.precio_total, om.activo,
             tm.id_tipo_marco, tm.nombre, tm.material, tm.precio_adicional
      FROM obras_marcos om
      INNER JOIN tipos_marco tm ON tm.id_tipo_marco = om.id_tipo_marco
      WHERE om.id_obra_tamaño=$1
      ORDER BY tm.precio_adicional ASC
    `, [id_obra_tamano]);

    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error(`getObrasMarcos: ${err.message}`);
    res.status(500).json({ success: false, message: 'Error al obtener marcos' });
  }
};

export const asignarMarcoObra = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const { id_obra_tamano } = req.params;
    const { id_tipo_marco } = req.body;
    const id_usuario = req.user.id_usuario;

    if (!id_tipo_marco)
      return res.status(400).json({ success: false, message: 'id_tipo_marco es requerido' });

    const check = await db.query(
      `SELECT ot.id, ot.precio_base FROM obras_tamaños ot
       INNER JOIN obras o ON o.id_obra = ot.id_obra
       WHERE ot.id=$1 AND o.id_usuario_creacion=$2 LIMIT 1`,
      [id_obra_tamano, id_usuario]
    );
    if (!check.rows.length)
      return res.status(403).json({ success: false, message: 'No tienes acceso a este registro' });

    const marco = await db.query(
      'SELECT precio_adicional FROM tipos_marco WHERE id_tipo_marco=$1 AND activo=TRUE LIMIT 1',
      [id_tipo_marco]
    );
    if (!marco.rows.length)
      return res.status(404).json({ success: false, message: 'Marco no encontrado o inactivo' });

    const precio_total = Number(check.rows[0].precio_base) + Number(marco.rows[0].precio_adicional);

    const result = await db.query(
      `INSERT INTO obras_marcos (id_obra_tamaño, id_tipo_marco, precio_total, activo)
       VALUES ($1,$2,$3,TRUE)
       ON CONFLICT (id_obra_tamaño, id_tipo_marco) DO UPDATE SET activo=TRUE, precio_total=$3
       RETURNING *`,
      [id_obra_tamano, id_tipo_marco, precio_total]
    );
    res.status(201).json({ success: true, message: 'Marco asignado', data: result.rows[0] });
  } catch (err) {
    logger.error(`asignarMarcoObra: ${err.message}`);
    res.status(500).json({ success: false, message: 'Error al asignar marco' });
  }
};

export const eliminarMarcoObra = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const { id } = req.params;
    const id_usuario = req.user.id_usuario;

    const check = await db.query(
      `SELECT om.id FROM obras_marcos om
       INNER JOIN obras_tamaños ot ON ot.id = om.id_obra_tamaño
       INNER JOIN obras o ON o.id_obra = ot.id_obra
       WHERE om.id=$1 AND o.id_usuario_creacion=$2 LIMIT 1`,
      [id, id_usuario]
    );
    if (!check.rows.length)
      return res.status(403).json({ success: false, message: 'No tienes acceso' });

    await db.query('UPDATE obras_marcos SET activo=FALSE WHERE id=$1', [id]);
    res.json({ success: true, message: 'Marco desasignado de la obra' });
  } catch (err) {
    logger.error(`eliminarMarcoObra: ${err.message}`);
    res.status(500).json({ success: false, message: 'Error al eliminar marco' });
  }
};
