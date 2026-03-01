import { pool } from "../config/db.js";

const secureLog = {
  info:  (msg, meta = {}) => console.log(`ℹ️ ${msg}`, Object.keys(meta).length ? meta : ''),
  error: (msg, err)       => console.error(`❌ ${msg}`, { name: err.name, code: err.code }),
};

// =========================================================
// 📚 LISTAR TODOS LOS ARTISTAS
// =========================================================
export const listarArtistas = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        a.id_artista, a.nombre_completo, a.nombre_artistico,
        a.biografia, a.foto_perfil, a.correo, a.telefono,
        a.matricula, a.porcentaje_comision, a.estado,
        c.nombre AS categoria_nombre,
        COUNT(o.id_obra)                                                        AS total_obras,
        COUNT(o.id_obra) FILTER (WHERE o.estado = 'aprobada' AND o.activa = TRUE) AS obras_publicadas,
        COUNT(o.id_obra) FILTER (WHERE o.estado = 'pendiente')                  AS obras_pendientes,
        COUNT(o.id_obra) FILTER (WHERE o.estado = 'rechazada')                  AS obras_rechazadas
      FROM artistas a
      LEFT JOIN categorias c ON a.id_categoria_principal = c.id_categoria
      LEFT JOIN obras o ON a.id_artista = o.id_artista          -- ✅ sin filtro activa
      WHERE a.activo = TRUE AND a.eliminado = FALSE
      GROUP BY a.id_artista, c.nombre
      ORDER BY a.nombre_completo ASC
    `);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    secureLog.error('Error al listar artistas', error);
    res.status(500).json({ success: false, message: "Error al obtener los artistas" });
  }
};

// =========================================================
// 🔍 OBTENER ARTISTA POR ID
// =========================================================
export const obtenerArtistaPorId = async (req, res) => {
  try {
    const { id } = req.params;

    const resultArtista = await pool.query(`
      SELECT a.*, c.nombre AS categoria_nombre,
        COUNT(o.id_obra)                                                          AS total_obras,
        COUNT(o.id_obra) FILTER (WHERE o.estado = 'aprobada' AND o.activa = TRUE) AS obras_publicadas,
        COUNT(o.id_obra) FILTER (WHERE o.estado = 'pendiente')                    AS obras_pendientes,
        COUNT(o.id_obra) FILTER (WHERE o.estado = 'rechazada')                    AS obras_rechazadas
      FROM artistas a
      LEFT JOIN categorias c ON a.id_categoria_principal = c.id_categoria
      LEFT JOIN obras o ON a.id_artista = o.id_artista          -- ✅ sin filtro activa
      WHERE a.id_artista = $1 AND a.activo = TRUE AND a.eliminado = FALSE
      GROUP BY a.id_artista, c.nombre
      LIMIT 1
    `, [id]);

    if (resultArtista.rows.length === 0)
      return res.status(404).json({ success: false, message: "Artista no encontrado" });

    const artista = resultArtista.rows[0];

    // ✅ Trae TODAS las obras (pendientes, aprobadas, rechazadas)
    const resultObras = await pool.query(`
      SELECT o.id_obra, o.titulo, o.slug, o.imagen_principal,
        o.anio_creacion, o.estado, o.activa, o.precio_base,
        c.nombre AS categoria_nombre
      FROM obras o
      INNER JOIN categorias c ON o.id_categoria = c.id_categoria
      WHERE o.id_artista = $1                                   -- ✅ sin filtro activa
      ORDER BY o.fecha_creacion DESC
    `, [id]);

    res.json({ success: true, data: { ...artista, obras: resultObras.rows } });
  } catch (error) {
    secureLog.error('Error al obtener artista', error);
    res.status(500).json({ success: false, message: "Error al obtener el artista" });
  }
};

// =========================================================
// ➕ CREAR ARTISTA
// =========================================================
// =========================================================
// ➕ CREAR ARTISTA
// =========================================================
export const crearArtista = async (req, res) => {
  try {
    const {
      nombre_completo, nombre_artistico, biografia,
      correo, telefono, matricula,
      id_categoria_principal, porcentaje_comision, estado
    } = req.body;

    // ✅ Acepta archivo subido O url manual
    const foto_perfil = req.file?.path || req.body.foto_perfil || null;

    if (!nombre_completo)
      return res.status(400).json({ success: false, message: "El nombre completo es obligatorio" });

    if (correo) {
      const exists = await pool.query(
        'SELECT id_artista FROM artistas WHERE correo = $1 AND eliminado = FALSE LIMIT 1', [correo]
      );
      if (exists.rows.length > 0)
        return res.status(400).json({ success: false, message: "Ya existe un artista con ese correo" });
    }

    const result = await pool.query(`
      INSERT INTO artistas (
        nombre_completo, nombre_artistico, biografia,
        foto_perfil, correo, telefono, matricula,
        id_categoria_principal, porcentaje_comision, estado,
        activo, eliminado
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, TRUE, FALSE)
      RETURNING id_artista
    `, [
      nombre_completo,
      nombre_artistico || null,
      biografia || null,
      foto_perfil,            // ✅ ya resuelto arriba
      correo || null,
      telefono || null,
      matricula || null,
      id_categoria_principal || null,
      porcentaje_comision || 15,
      estado || 'pendiente'
    ]);

    const { id_artista } = result.rows[0];
    secureLog.info('Artista creado', { id_artista });

    res.status(201).json({ success: true, message: 'Artista creado exitosamente', data: { id_artista } });
  } catch (error) {
    secureLog.error('Error al crear artista', error);
    res.status(500).json({ success: false, message: 'Error al crear el artista' });
  }
};

// =========================================================
// ✏️ ACTUALIZAR ARTISTA
// =========================================================
export const actualizarArtista = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nombre_completo, nombre_artistico, biografia,
      correo, telefono, matricula,
      id_categoria_principal, porcentaje_comision, estado
    } = req.body;

    // ✅ Acepta archivo subido O url manual
    const foto_perfil = req.file?.path || req.body.foto_perfil || null;

    await pool.query(`
      UPDATE artistas SET
        nombre_completo=$1, nombre_artistico=$2, biografia=$3,
        foto_perfil=$4, correo=$5, telefono=$6, matricula=$7,
        id_categoria_principal=$8, porcentaje_comision=$9, estado=$10
      WHERE id_artista=$11 AND eliminado=FALSE
    `, [
      nombre_completo,
      nombre_artistico || null,
      biografia || null,
      foto_perfil,            // ✅ ya resuelto arriba
      correo || null,
      telefono || null,
      matricula || null,
      id_categoria_principal || null,
      porcentaje_comision || 15,
      estado || 'pendiente',
      id
    ]);

    res.json({ success: true, message: 'Artista actualizado exitosamente' });
  } catch (error) {
    secureLog.error('Error al actualizar artista', error);
    res.status(500).json({ success: false, message: 'Error al actualizar el artista' });
  }
};
// =========================================================
// 🗑️ ELIMINAR ARTISTA (soft delete)
// =========================================================
export const eliminarArtista = async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query(`
      UPDATE artistas SET eliminado=TRUE, activo=FALSE
      WHERE id_artista=$1
    `, [id]);

    res.json({ success: true, message: 'Artista eliminado correctamente' });
  } catch (error) {
    secureLog.error('Error al eliminar artista', error);
    res.status(500).json({ success: false, message: 'Error al eliminar el artista' });
  }
};