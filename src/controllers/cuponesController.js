import { pool } from "../config/db.js";
import logger from "../config/logger.js";

const fmtMXN = (n) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);

// =========================================================
// ADMIN — CRUD DE CUPONES
// =========================================================

export const listarCupones = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *,
        CASE
          WHEN NOT activo THEN 'inactivo'
          WHEN fecha_fin IS NOT NULL AND fecha_fin < NOW() THEN 'expirado'
          WHEN usos_max IS NOT NULL AND usos_actuales >= usos_max THEN 'agotado'
          ELSE 'activo'
        END AS estado_real
      FROM cupones
      ORDER BY creado_en DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error(`listarCupones: ${err.message}`);
    res.status(500).json({ success: false, message: "Error al obtener cupones" });
  }
};

export const crearCupon = async (req, res) => {
  try {
    const { codigo, descripcion, tipo, valor, monto_minimo, fecha_fin, usos_max, activo } = req.body;
    if (!codigo?.trim() || !tipo || !valor)
      return res.status(400).json({ success: false, message: "Código, tipo y valor son requeridos" });
    if (!["porcentaje", "monto"].includes(tipo))
      return res.status(400).json({ success: false, message: "Tipo debe ser 'porcentaje' o 'monto'" });
    if (tipo === "porcentaje" && (Number(valor) <= 0 || Number(valor) > 100))
      return res.status(400).json({ success: false, message: "El porcentaje debe ser entre 1 y 100" });

    const result = await pool.query(
      `INSERT INTO cupones (codigo, descripcion, tipo, valor, monto_minimo, fecha_fin, usos_max, activo)
       VALUES (UPPER($1), $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [codigo.trim(), descripcion || null, tipo, valor, monto_minimo || 0, fecha_fin || null, usos_max || null, activo !== false]
    );
    res.status(201).json({ success: true, message: "Cupón creado", data: result.rows[0] });
  } catch (err) {
    if (err.code === "23505")
      return res.status(409).json({ success: false, message: "Ya existe un cupón con ese código" });
    logger.error(`crearCupon: ${err.message}`);
    res.status(500).json({ success: false, message: "Error al crear cupón" });
  }
};

export const actualizarCupon = async (req, res) => {
  try {
    const { id } = req.params;
    const { descripcion, tipo, valor, monto_minimo, fecha_fin, usos_max, activo } = req.body;

    const result = await pool.query(
      `UPDATE cupones
       SET descripcion=$1, tipo=$2, valor=$3, monto_minimo=$4, fecha_fin=$5, usos_max=$6, activo=$7
       WHERE id_cupon=$8 RETURNING *`,
      [descripcion || null, tipo, valor, monto_minimo || 0, fecha_fin || null, usos_max || null, activo !== false, id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ success: false, message: "Cupón no encontrado" });
    res.json({ success: true, message: "Cupón actualizado", data: result.rows[0] });
  } catch (err) {
    logger.error(`actualizarCupon: ${err.message}`);
    res.status(500).json({ success: false, message: "Error al actualizar cupón" });
  }
};

export const eliminarCupon = async (req, res) => {
  try {
    const { id } = req.params;
    const check = await pool.query("SELECT usos_actuales FROM cupones WHERE id_cupon = $1", [id]);
    if (!check.rows.length) return res.status(404).json({ success: false, message: "Cupón no encontrado" });
    if (check.rows[0].usos_actuales > 0)
      return res.status(409).json({ success: false, message: "No se puede eliminar un cupón que ya fue usado. Desactívalo en su lugar." });

    await pool.query("DELETE FROM cupones WHERE id_cupon = $1", [id]);
    res.json({ success: true, message: "Cupón eliminado" });
  } catch (err) {
    logger.error(`eliminarCupon: ${err.message}`);
    res.status(500).json({ success: false, message: "Error al eliminar cupón" });
  }
};

// =========================================================
// CLIENTE — VALIDAR CUPÓN
// =========================================================

export const validarCupon = async (req, res) => {
  try {
    const { codigo, total } = req.body;
    const id_usuario = req.user.id_usuario;

    if (!codigo?.trim())
      return res.status(400).json({ success: false, message: "Ingresa un código de cupón" });

    const result = await pool.query(
      `SELECT * FROM cupones
       WHERE codigo = UPPER($1) AND activo = TRUE
         AND (fecha_fin IS NULL OR fecha_fin > NOW())
         AND (usos_max  IS NULL OR usos_actuales < usos_max)`,
      [codigo.trim()]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ success: false, message: "Cupón no válido o expirado" });

    const cupon = result.rows[0];

    // Verificar uso previo del mismo usuario
    const yaUsado = await pool.query(
      "SELECT id FROM cupones_usados WHERE id_cupon = $1 AND id_usuario = $2",
      [cupon.id_cupon, id_usuario]
    );
    if (yaUsado.rows.length > 0)
      return res.status(409).json({ success: false, message: "Ya usaste este cupón anteriormente" });

    // Verificar monto mínimo
    if (cupon.monto_minimo && Number(total) < Number(cupon.monto_minimo))
      return res.status(400).json({
        success: false,
        message: `Mínimo de compra requerido: ${fmtMXN(cupon.monto_minimo)}`,
      });

    // Calcular descuento
    const descuento =
      cupon.tipo === "porcentaje"
        ? (Number(total) * Number(cupon.valor)) / 100
        : Math.min(Number(cupon.valor), Number(total));

    const descuentoRedondeado = Math.round(descuento * 100) / 100;

    res.json({
      success: true,
      data: {
        id_cupon:    cupon.id_cupon,
        codigo:      cupon.codigo,
        descripcion: cupon.descripcion,
        tipo:        cupon.tipo,
        valor:       cupon.valor,
        descuento:   descuentoRedondeado,
        total_final: Number(total) - descuentoRedondeado,
      },
    });
  } catch (err) {
    logger.error(`validarCupon: ${err.message}`);
    res.status(500).json({ success: false, message: "Error al validar cupón" });
  }
};

// =========================================================
// PÚBLICO — CUPONES ACTIVOS PARA MOSTRAR AL CLIENTE
// =========================================================

export const listarCuponesPublicos = async (req, res) => {
  try {
    const id_usuario = req.user?.id_usuario ?? null;
    const result = await pool.query(`
      SELECT c.codigo, c.descripcion, c.tipo, c.valor, c.monto_minimo, c.fecha_fin
      FROM cupones c
      WHERE c.activo = TRUE
        AND (c.fecha_fin IS NULL OR c.fecha_fin > NOW())
        AND (c.usos_max  IS NULL OR c.usos_actuales < c.usos_max)
        AND ($1::int IS NULL OR NOT EXISTS (
          SELECT 1 FROM cupones_usados cu
          WHERE cu.id_cupon = c.id_cupon AND cu.id_usuario = $1
        ))
      ORDER BY c.creado_en DESC
      LIMIT 10
    `, [id_usuario]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    logger.error(`listarCuponesPublicos: ${err.message}`);
    res.status(500).json({ success: false, message: "Error" });
  }
};
