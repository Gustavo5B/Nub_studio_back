import { pool, pools } from '../config/db.js';
import logger from '../config/logger.js';

// =========================================================
// ADMIN — catálogo de tamaños_disponibles
// =========================================================

export const listarTamañosAdmin = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM tamaños_disponibles
      WHERE eliminado IS NOT TRUE
      ORDER BY ancho_cm ASC NULLS LAST, nombre ASC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error(`listarTamañosAdmin: ${err.message}`);
    res.status(500).json({ success: false, message: 'Error al obtener tamaños' });
  }
};

export const crearTamaño = async (req, res) => {
  try {
    const { nombre, ancho_cm, alto_cm, descripcion } = req.body;
    if (!nombre?.trim())
      return res.status(400).json({ success: false, message: 'El nombre es requerido' });

    const result = await pool.query(
      `INSERT INTO tamaños_disponibles (nombre, ancho_cm, alto_cm, descripcion, activo, eliminado)
       VALUES ($1, $2, $3, $4, TRUE, FALSE) RETURNING *`,
      [nombre.trim(), ancho_cm || null, alto_cm || null, descripcion || null]
    );
    res.status(201).json({ success: true, message: 'Tamaño creado', data: result.rows[0] });
  } catch (err) {
    logger.error(`crearTamaño: ${err.message}`);
    res.status(500).json({ success: false, message: 'Error al crear tamaño' });
  }
};

export const actualizarTamaño = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, ancho_cm, alto_cm, descripcion, activo } = req.body;

    const result = await pool.query(
      `UPDATE tamaños_disponibles
       SET nombre=$1, ancho_cm=$2, alto_cm=$3, descripcion=$4, activo=$5
       WHERE id_tamaño=$6 AND eliminado IS NOT TRUE RETURNING *`,
      [nombre, ancho_cm || null, alto_cm || null, descripcion || null, activo !== false, id]
    );
    if (!result.rows.length)
      return res.status(404).json({ success: false, message: 'Tamaño no encontrado' });

    res.json({ success: true, message: 'Tamaño actualizado', data: result.rows[0] });
  } catch (err) {
    logger.error(`actualizarTamaño: ${err.message}`);
    res.status(500).json({ success: false, message: 'Error al actualizar tamaño' });
  }
};

export const eliminarTamaño = async (req, res) => {
  try {
    const { id } = req.params;
    const enUso = await pool.query(
      'SELECT COUNT(*) AS c FROM obras_tamaños WHERE id_tamaño=$1 AND activo=TRUE', [id]
    );
    if (parseInt(enUso.rows[0].c) > 0)
      return res.status(409).json({
        success: false,
        message: 'Este tamaño está asignado a obras activas. Desactívalo primero.',
      });

    await pool.query(
      `UPDATE tamaños_disponibles SET eliminado=TRUE, activo=FALSE, fecha_eliminacion=NOW()
       WHERE id_tamaño=$1`, [id]
    );
    res.json({ success: true, message: 'Tamaño eliminado' });
  } catch (err) {
    logger.error(`eliminarTamaño: ${err.message}`);
    res.status(500).json({ success: false, message: 'Error al eliminar tamaño' });
  }
};

// =========================================================
// PÚBLICO — catálogo activo y tamaños de una obra
// =========================================================

export const listarTamañosPublico = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id_tamaño, nombre, ancho_cm, alto_cm, descripcion
      FROM tamaños_disponibles
      WHERE activo = TRUE AND eliminado IS NOT TRUE
      ORDER BY ancho_cm ASC NULLS LAST, nombre ASC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error(`listarTamañosPublico: ${err.message}`);
    res.status(500).json({ success: false, message: 'Error al obtener tamaños' });
  }
};

export const getTamañosPorObra = async (req, res) => {
  try {
    const { id_obra } = req.params;
    const result = await pool.query(`
      SELECT
        ot.id            AS id_obra_tamano,
        ot.precio_base,
        ot.cantidad_disponible,
        td.id_tamaño,
        td.nombre,
        td.ancho_cm,
        td.alto_cm,
        td.descripcion
      FROM obras_tamaños ot
      INNER JOIN tamaños_disponibles td ON td.id_tamaño = ot.id_tamaño
      WHERE ot.id_obra = $1
        AND ot.activo = TRUE
        AND td.activo = TRUE
        AND td.eliminado IS NOT TRUE
      ORDER BY td.ancho_cm ASC NULLS LAST
    `, [id_obra]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error(`getTamañosPorObra: ${err.message}`);
    res.status(500).json({ success: false, message: 'Error al obtener tamaños' });
  }
};

// =========================================================
// ARTISTA — gestión de tamaños de sus obras (obras_tamaños)
// =========================================================

export const getTamañosDeObra = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const { id_obra } = req.params;
    const id_usuario = req.user.id_usuario;

    const ownership = await db.query(
      'SELECT id_obra FROM obras WHERE id_obra=$1 AND id_usuario_creacion=$2 LIMIT 1',
      [id_obra, id_usuario]
    );
    if (!ownership.rows.length)
      return res.status(403).json({ success: false, message: 'No tienes acceso a esta obra' });

    const result = await db.query(`
      SELECT
        ot.id AS id_obra_tamano,
        ot.precio_base,
        ot.cantidad_disponible,
        ot.activo,
        td.id_tamaño,
        td.nombre,
        td.ancho_cm,
        td.alto_cm
      FROM obras_tamaños ot
      INNER JOIN tamaños_disponibles td ON td.id_tamaño = ot.id_tamaño
      WHERE ot.id_obra = $1
      ORDER BY td.ancho_cm ASC NULLS LAST
    `, [id_obra]);

    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error(`getTamañosDeObra: ${err.message}`);
    res.status(500).json({ success: false, message: 'Error al obtener tamaños' });
  }
};

export const asignarTamañoObra = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const { id_obra } = req.params;
    const { id_tamaño, precio_base, cantidad_disponible } = req.body;
    const id_usuario = req.user.id_usuario;

    if (!id_tamaño || !precio_base)
      return res.status(400).json({ success: false, message: 'Tamaño y precio son requeridos' });

    const ownership = await db.query(
      'SELECT id_obra FROM obras WHERE id_obra=$1 AND id_usuario_creacion=$2 LIMIT 1',
      [id_obra, id_usuario]
    );
    if (!ownership.rows.length)
      return res.status(403).json({ success: false, message: 'No tienes acceso a esta obra' });

    const result = await db.query(
      `INSERT INTO obras_tamaños (id_obra, id_tamaño, precio_base, cantidad_disponible, activo)
       VALUES ($1, $2, $3, $4, TRUE)
       ON CONFLICT (id_obra, id_tamaño) DO UPDATE
         SET precio_base=$3, cantidad_disponible=$4, activo=TRUE
       RETURNING *`,
      [id_obra, id_tamaño, precio_base, cantidad_disponible ?? 1]
    );
    res.status(201).json({ success: true, message: 'Tamaño asignado', data: result.rows[0] });
  } catch (err) {
    logger.error(`asignarTamañoObra: ${err.message}`);
    res.status(500).json({ success: false, message: 'Error al asignar tamaño' });
  }
};

export const actualizarTamañoObra = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const { id } = req.params;
    const { precio_base, cantidad_disponible, activo } = req.body;
    const id_usuario = req.user.id_usuario;

    const check = await db.query(
      `SELECT ot.id FROM obras_tamaños ot
       INNER JOIN obras o ON o.id_obra = ot.id_obra
       WHERE ot.id=$1 AND o.id_usuario_creacion=$2 LIMIT 1`,
      [id, id_usuario]
    );
    if (!check.rows.length)
      return res.status(403).json({ success: false, message: 'No tienes acceso a este registro' });

    const result = await db.query(
      `UPDATE obras_tamaños SET precio_base=$1, cantidad_disponible=$2, activo=$3
       WHERE id=$4 RETURNING *`,
      [precio_base, cantidad_disponible, activo !== false, id]
    );
    res.json({ success: true, message: 'Actualizado', data: result.rows[0] });
  } catch (err) {
    logger.error(`actualizarTamañoObra: ${err.message}`);
    res.status(500).json({ success: false, message: 'Error al actualizar' });
  }
};

export const eliminarTamañoObra = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;
    const { id } = req.params;
    const id_usuario = req.user.id_usuario;

    const check = await db.query(
      `SELECT ot.id FROM obras_tamaños ot
       INNER JOIN obras o ON o.id_obra = ot.id_obra
       WHERE ot.id=$1 AND o.id_usuario_creacion=$2 LIMIT 1`,
      [id, id_usuario]
    );
    if (!check.rows.length)
      return res.status(403).json({ success: false, message: 'No tienes acceso a este registro' });

    await db.query('UPDATE obras_tamaños SET activo=FALSE WHERE id=$1', [id]);
    res.json({ success: true, message: 'Tamaño desactivado de la obra' });
  } catch (err) {
    logger.error(`eliminarTamañoObra: ${err.message}`);
    res.status(500).json({ success: false, message: 'Error al eliminar' });
  }
};
