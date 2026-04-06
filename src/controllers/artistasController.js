import crypto from 'crypto';
import { pool, pools } from "../config/db.js";
import logger from "../config/logger.js";
import {
  sendArtistaAprobadoEmail,
  sendArtistaRechazadoEmail,
  sendActivacionCuentaEmail,
} from '../services/emailService.js';

// ─────────────────────────────────────────────────────────────
// HELPERS — usan pool base (no tienen req, son internos)
// ─────────────────────────────────────────────────────────────

const generarMatricula = async () => {
  const anio = new Date().getFullYear();
  const res  = await pool.query(`SELECT COUNT(*) AS total FROM artistas WHERE eliminado = FALSE`);
  const secuencial = parseInt(res.rows[0].total) + 1;
  const numero     = String(secuencial).padStart(4, '0');
  const matricula  = `NUB-${anio}-${numero}`;

  const existe = await pool.query(
    'SELECT id_artista FROM artistas WHERE matricula = $1 LIMIT 1', [matricula]
  );
  if (existe.rows.length > 0) {
    const sufijo = String(Math.floor(Math.random() * 99) + 1).padStart(2, '0');
    return `NUB-${anio}-${numero}-${sufijo}`;
  }
  return matricula;
};

const generarTokenActivacion = () => ({
  token:      crypto.randomBytes(32).toString('hex'),
  expiracion: new Date(Date.now() + 48 * 60 * 60 * 1000),
});

// =========================================================
// LISTAR TODOS LOS ARTISTAS
// GET /api/artistas
// =========================================================
export const listarArtistas = async (req, res) => {
  try {
    const db = pools[req.user?.rol] || pool;

    const isAdmin = req.user?.rol === 'admin';
    const result = await db.query(`
      SELECT
        a.id_artista, a.nombre_completo, a.nombre_artistico,
        a.biografia, a.foto_perfil, a.foto_portada, a.foto_logo,
        a.correo, a.telefono, a.matricula, a.porcentaje_comision, a.estado,
        c.nombre AS categoria_nombre,
        COUNT(o.id_obra)                                                          AS total_obras,
        COUNT(o.id_obra) FILTER (WHERE o.estado = 'aprobada' AND o.activa = TRUE) AS obras_publicadas,
        COUNT(o.id_obra) FILTER (WHERE o.estado = 'pendiente')                    AS obras_pendientes,
        COUNT(o.id_obra) FILTER (WHERE o.estado = 'rechazada')                    AS obras_rechazadas
      FROM artistas a
      LEFT JOIN categorias c ON a.id_categoria_principal = c.id_categoria
      LEFT JOIN obras o ON a.id_artista = o.id_artista
      WHERE ${isAdmin ? '' : "a.activo = TRUE AND a.estado = 'activo' AND"} a.eliminado = FALSE
      GROUP BY a.id_artista, c.nombre
      ORDER BY
        a.activo DESC,
        CASE a.estado
          WHEN 'activo'     THEN 1
          WHEN 'pendiente'  THEN 2
          WHEN 'suspendido' THEN 3
          WHEN 'inactivo'   THEN 4
          WHEN 'rechazado'  THEN 5
          ELSE 6
        END,
        a.nombre_completo ASC
    `);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    logger.error(`Error al listar artistas: ${error.message} | ${error.stack}`);
    res.status(500).json({ success: false, message: "Error al obtener los artistas" });
  }
};

// =========================================================
// OBTENER ARTISTA POR ID
// GET /api/artistas/:id
// =========================================================
export const obtenerArtistaPorId = async (req, res) => {
  try {
    const { id }  = req.params;
    const isAdmin = req.user?.rol === 'admin';

    const db = isAdmin ? pool : (pools[req.user?.rol] || pool);

    const whereClause = isAdmin
      ? 'WHERE a.id_artista = $1 AND a.eliminado = FALSE'
      : 'WHERE a.id_artista = $1 AND a.activo = TRUE AND a.eliminado = FALSE';

    const resultArtista = await db.query(`
      SELECT a.*, c.nombre AS categoria_nombre,
        COUNT(o.id_obra)                                                          AS total_obras,
        COUNT(o.id_obra) FILTER (WHERE o.estado = 'aprobada' AND o.activa = TRUE) AS obras_publicadas,
        COUNT(o.id_obra) FILTER (WHERE o.estado = 'pendiente')                    AS obras_pendientes,
        COUNT(o.id_obra) FILTER (WHERE o.estado = 'rechazada')                    AS obras_rechazadas
      FROM artistas a
      LEFT JOIN categorias c ON a.id_categoria_principal = c.id_categoria
      LEFT JOIN obras o ON a.id_artista = o.id_artista
      ${whereClause}
      GROUP BY a.id_artista, c.nombre
      LIMIT 1
    `, [id]);

    if (resultArtista.rows.length === 0)
      return res.status(404).json({ success: false, message: "Artista no encontrado" });

    const artista = resultArtista.rows[0];

    const dbObras = isAdmin ? pool : db;
    const resultObras = await dbObras.query(`
      SELECT o.id_obra, o.titulo, o.slug, o.imagen_principal,
        o.anio_creacion, o.estado, o.activa, o.precio_base,
        c.nombre AS categoria_nombre
      FROM obras o
      INNER JOIN categorias c ON o.id_categoria = c.id_categoria
      WHERE o.id_artista = $1
      ORDER BY o.fecha_creacion DESC
    `, [id]);

    // 👇 AGREGAR ESTO - usa la misma variable 'db' que ya existe
    const fotosPersonales = await db.query(`
      SELECT id_foto, url_foto, es_principal, orden
      FROM artistas_fotos_personales
      WHERE id_artista = $1 AND activa = TRUE
      ORDER BY es_principal DESC, orden ASC
    `, [id]);

    res.json({ 
      success: true, 
      data: { 
        ...artista, 
        obras: resultObras.rows,
        fotos_personales: fotosPersonales.rows  // 👈 ESTO DEVUELVE LAS FOTOS
      } 
    });
  } catch (error) {
    logger.error(`Error al obtener artista: ${error.message} | ${error.stack}`);
    res.status(500).json({ success: false, message: "Error al obtener el artista" });
  }
};

// =========================================================
// CREAR ARTISTA — admin crea un artista
// POST /api/artistas
// =========================================================
export const crearArtista = async (req, res) => {
  try {
    const db = pools[req.user.rol] || pool;

    const {
      nombre_completo, nombre_artistico, biografia,
      correo, telefono,
      id_categoria_principal, porcentaje_comision, estado,
    } = req.body;

    const foto_perfil = req.file?.path || req.body.foto_perfil || null;

    if (!nombre_completo)
      return res.status(400).json({ success: false, message: "El nombre completo es obligatorio" });

    if (correo) {
      const existeArtista = await db.query(
        'SELECT id_artista FROM artistas WHERE correo = $1 AND eliminado = FALSE LIMIT 1', [correo]
      );
      if (existeArtista.rows.length > 0)
        return res.status(400).json({ success: false, message: "Ya existe un artista con ese correo" });

      const existeUsuario = await db.query(
        'SELECT id_usuario FROM usuarios WHERE correo = $1 LIMIT 1', [correo]
      );
      if (existeUsuario.rows.length > 0)
        return res.status(400).json({ success: false, message: "El correo ya está registrado en el sistema" });
    }

    let id_usuario      = null;
    let tokenActivacion = null;

    if (correo) {
      const { token, expiracion } = generarTokenActivacion();
      tokenActivacion = token;

      const resUsuario = await db.query(
        `INSERT INTO usuarios
           (nombre_completo, correo, contraseña_hash, rol, estado, activo,
            verificado, token_verificacion, token_expiracion)
         VALUES ($1, $2, NULL, 'artista', 'pendiente', TRUE, FALSE, $3, $4)
         RETURNING id_usuario`,
        [nombre_completo, correo, token, expiracion]
      );
      id_usuario = resUsuario.rows[0].id_usuario;
    }

    const matricula = await generarMatricula();

    const result = await db.query(`
      INSERT INTO artistas (
        id_usuario, nombre_completo, nombre_artistico, biografia,
        foto_perfil, correo, telefono, matricula,
        id_categoria_principal, porcentaje_comision, estado,
        activo, eliminado
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, TRUE, FALSE)
      RETURNING id_artista, matricula
    `, [
      id_usuario,
      nombre_completo,
      nombre_artistico       || null,
      biografia              || null,
      foto_perfil,
      correo                 || null,
      telefono               || null,
      matricula,
      id_categoria_principal || null,
      porcentaje_comision    || 15,
      estado                 || 'pendiente',
    ]);

    const { id_artista, matricula: mat } = result.rows[0];
    logger.info(`Artista creado: id ${id_artista} mat ${mat}${id_usuario ? ' usuario=' + id_usuario : ''}`);

    if (correo && tokenActivacion) {
      sendActivacionCuentaEmail(correo, nombre_completo, tokenActivacion).catch(err =>
        logger.error(`Error email activación artista ${id_artista}: ${err.message}`)
      );
    }

    res.status(201).json({
      success: true,
      message: correo
        ? "Artista creado. Se envió un email para que configure su contraseña."
        : "Artista creado sin acceso al portal (sin correo).",
      data: { id_artista, matricula: mat, correo: correo || null },
    });

  } catch (error) {
    logger.error(`Error al crear artista: ${error.message} | ${error.stack}`);
    if (error.code === '23505')
      return res.status(400).json({ success: false, message: "El correo ya está registrado" });
    res.status(500).json({ success: false, message: 'Error al crear el artista' });
  }
};

// =========================================================
// ACTUALIZAR ARTISTA
// PUT /api/artistas/:id
// =========================================================
export const actualizarArtista = async (req, res) => {
  try {
    const db = pools[req.user.rol] || pool;
    const { id } = req.params;

    const {
      nombre_completo, nombre_artistico, biografia,
      correo, telefono,
      id_categoria_principal, porcentaje_comision, estado,
    } = req.body;

    const foto_perfil = req.file?.path || req.body.foto_perfil || null;

    await db.query(`
      UPDATE artistas SET
        nombre_completo        = $1,
        nombre_artistico       = $2,
        biografia              = $3,
        foto_perfil            = COALESCE($4, foto_perfil),
        correo                 = $5,
        telefono               = $6,
        id_categoria_principal = $7,
        porcentaje_comision    = $8,
        estado                 = $9
      WHERE id_artista = $10 AND eliminado = FALSE
    `, [
      nombre_completo,
      nombre_artistico       || null,
      biografia              || null,
      foto_perfil,
      correo                 || null,
      telefono               || null,
      id_categoria_principal || null,
      porcentaje_comision    || 15,
      estado                 || 'pendiente',
      id,
    ]);

    logger.info(`Artista actualizado: id ${id}`);
    res.json({ success: true, message: 'Artista actualizado exitosamente' });
  } catch (error) {
    logger.error(`Error al actualizar artista: ${error.message} | ${error.stack}`);
    res.status(500).json({ success: false, message: 'Error al actualizar el artista' });
  }
};

// =========================================================
// ELIMINAR ARTISTA — soft delete
// DELETE /api/artistas/:id
// =========================================================
export const eliminarArtista = async (req, res) => {
  try {
    const db = pools[req.user.rol] || pool;
    const { id } = req.params;

    await db.query(`
      UPDATE artistas SET eliminado = TRUE, activo = FALSE
      WHERE id_artista = $1
    `, [id]);

    res.json({ success: true, message: 'Artista eliminado correctamente' });
  } catch (error) {
    logger.error(`Error al eliminar artista: ${error.message} | ${error.stack}`);
    res.status(500).json({ success: false, message: 'Error al eliminar el artista' });
  }
};

// =========================================================
// CAMBIAR ESTADO DE ARTISTA — admin only
// PATCH /api/artistas/:id/estado
// =========================================================
export const cambiarEstadoArtista = async (req, res) => {
  try {
    const db = pools[req.user.rol] || pool;
    const { id }             = req.params;
    const { estado, motivo } = req.body;
    const id_admin           = req.user?.id_usuario;

    const estadosValidos = ["pendiente", "activo", "inactivo", "rechazado", "suspendido"];
    if (!estadosValidos.includes(estado))
      return res.status(400).json({ success: false, message: "Estado inválido" });

    const artResult = await db.query(`
      SELECT
        a.id_artista,
        a.nombre_completo   AS artista_nombre,
        a.nombre_artistico,
        a.correo            AS artista_correo,
        u.id_usuario,
        u.correo            AS usuario_correo,
        u.nombre_completo   AS usuario_nombre,
        u.contraseña_hash,
        u.verificado
      FROM artistas a
      LEFT JOIN usuarios u ON u.id_usuario = a.id_usuario
      WHERE a.id_artista = $1 AND a.eliminado = FALSE
      LIMIT 1
    `, [id]);

    if (artResult.rows.length === 0)
      return res.status(404).json({ success: false, message: "Artista no encontrado" });

    const artista = artResult.rows[0];

    await db.query(`
      UPDATE artistas
      SET estado = $1, activo = $2
      WHERE id_artista = $3 AND eliminado = FALSE
    `, [estado, estado === 'activo', id]);

    logger.info(
      `Estado artista ${id} → "${estado}" | admin=${id_admin}`
      + (motivo ? ` | motivo="${motivo}"` : '')
    );

    res.json({
      success: true,
      message: `Artista ${estado === 'activo' ? 'aprobado' : estado} correctamente`,
      data: { id_artista: id, estado, activo: estado === 'activo' },
    });

    // ── Emails asincrónicos ─────────────────────────────────
    const correoDestino = artista.usuario_correo || artista.artista_correo;
    const nombreDestino = artista.usuario_nombre || artista.nombre_artistico || artista.artista_nombre;

    if (!correoDestino) return;

    if (estado === 'activo') {
      if (artista.id_usuario && !artista.contraseña_hash) {
        const { token, expiracion } = generarTokenActivacion();

        await db.query(`
          UPDATE usuarios
          SET token_verificacion = $1, token_expiracion = $2
          WHERE id_usuario = $3
        `, [token, expiracion, artista.id_usuario]);

        sendActivacionCuentaEmail(correoDestino, nombreDestino, token).catch(err =>
          logger.error(`Error email activación artista ${id}: ${err.message}`)
        );
      } else {
        sendArtistaAprobadoEmail(correoDestino, nombreDestino).catch(err =>
          logger.error(`Error email aprobación artista ${id}: ${err.message}`)
        );
      }
    } else if (estado === 'rechazado') {
      sendArtistaRechazadoEmail(correoDestino, nombreDestino, motivo || null).catch(err =>
        logger.error(`Error email rechazo artista ${id}: ${err.message}`)
      );
    }

  } catch (error) {
    logger.error(`Error al cambiar estado artista: ${error.message} | ${error.stack}`);
    if (!res.headersSent)
      res.status(500).json({ success: false, message: "Error al cambiar estado" });
  }
};

